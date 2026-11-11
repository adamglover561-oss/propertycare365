import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Only the signed-in Property Care 360 owner can prepare an assisted signup.
// Card details are collected by Stripe Checkout, never by this function.
const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const origin = "https://propertycare360.co.uk";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

function stringValue(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalized(value: string) { return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-GB"); }
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T12:00:00Z")) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
}
function errorResponse(error: unknown) {
  console.error("Assisted signup failed", error instanceof Error ? error.message : String(error));
  return respond(500, { error: "Could not prepare the signup. No payment has been taken. Please try again or contact support." });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed." });
  const bearer = req.headers.get("Authorization") || "";
  if (!bearer.startsWith("Bearer ")) return respond(401, { error: "Owner sign-in required." });
  try {
    const token = bearer.substring(7);
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: bearer } }
    });
    const { data: identity, error: identityError } = await userClient.auth.getUser(token);
    if (identityError || !identity?.user) return respond(401, { error: "Owner session expired." });
    const { data: isAdmin, error: adminError } = await userClient.rpc("is_home_care_admin");
    if (adminError || isAdmin !== true) return respond(403, { error: "Owner-only operation." });

    const input = await req.json().catch(() => null);
    if (!input || input.action !== "prepare") return respond(400, { error: "Invalid request." });
    const fullName = stringValue(input.fullName, 120);
    const email = stringValue(input.email, 250).toLowerCase();
    const phone = stringValue(input.phone, 40);
    const address = stringValue(input.address, 180);
    const town = stringValue(input.town, 100);
    const postcode = stringValue(input.postcode, 14).toUpperCase();
    const fuel = stringValue(input.fuel, 20);
    const serviceDateKind = stringValue(input.serviceDateKind, 20);
    const serviceDate = stringValue(input.serviceDate, 10);
    const typedName = stringValue(input.typedName, 120);
    const early = input.earlyServiceRequested === true;
    if (fullName.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        phone.length < 6 || !address || !town || postcode.length < 5)
      return respond(400, { error: "Enter a name, a usable customer email, phone and property address." });
    if (!["gas", "lpg", "oil"].includes(fuel))
      return respond(400, { error: "This membership is only for eligible gas, LPG or oil boilers." });
    if (!["due", "preferred", "unknown"].includes(serviceDateKind) ||
      (serviceDateKind !== "unknown" && !validDate(serviceDate)))
      return respond(400, { error: "Choose a valid boiler-service due or preferred date, or 'Not sure'." });
    if (input.customerAcceptedTerms !== true || normalized(typedName) !== normalized(fullName))
      return respond(400, { error: "Hand the tablet to the customer to review and personally accept the contract." });

    const { data: plan, error: planError } = await admin.from("plans")
      .select("monthly_price_pence,payment_link_url").eq("code", "home_care_core_1999").eq("active", true).single();
    if (planError || plan?.monthly_price_pence !== 1999 || !plan.payment_link_url)
      return respond(503, { error: "The £19.99 membership checkout is unavailable. No customer was created." });
    const stripe = new URL(plan.payment_link_url);
    if (stripe.protocol !== "https:" || stripe.hostname !== "buy.stripe.com")
      return respond(503, { error: "Secure checkout configuration is invalid." });

    // Do not silently create a second account or duplicate subscription.
    const { data: existing, error: existingError } = await admin.from("customers")
      .select("id").ilike("email", email).limit(1);
    if (existingError) throw existingError;
    if (existing?.length) return respond(409, {
      error: "This email already belongs to a Property Care 360 customer. Use their existing account instead."
    });

    let userId = "", customerId = "", propertyId = "";
    try {
      // Deliberately no password and no forced email confirmation: the customer can
      // activate app access later through the standard password-reset route.
      const { data: account, error: accountError } = await admin.auth.admin.createUser({
        email, email_confirm: false, user_metadata: { full_name: fullName, phone }
      });
      if (accountError || !account?.user) throw accountError || new Error("Customer account could not be created");
      userId = account.user.id;
      const { data: customer, error: customerError } = await admin.from("customers")
        .insert({
          user_id: userId, full_name: fullName, email, phone,
          terms_version: "1.7", terms_accepted_at: new Date().toISOString(),
          early_service_requested: early
        }).select("id").single();
      if (customerError) throw customerError;
      customerId = customer.id;

      const { data: property, error: propertyError } = await admin.from("properties")
        .insert({
          customer_id: customerId, address_line1: address, town_city: town,
          postcode, heating_fuel: fuel, boiler_service_date_kind: serviceDateKind,
          next_boiler_service_due: serviceDateKind === "due" ? serviceDate : null,
          preferred_boiler_service_date: serviceDateKind === "preferred" ? serviceDate : null
        }).select("id").single();
      if (propertyError) throw propertyError;
      propertyId = property.id;

      const { error: consentError } = await admin.from("membership_checkout_consents").insert({
        customer_id: customerId, property_id: propertyId, terms_version: "1.7",
        monthly_price_pence: 1999, initial_term_months: 12, first_year_total_pence: 23988,
        early_service_requested: early, acceptance_channel: "assisted_in_person",
        accepted_by_name: typedName, assisted_by: identity.user.id
      });
      if (consentError) throw consentError;
      stripe.searchParams.set("client_reference_id", "hc_" + customerId + "__" + propertyId);
      return respond(200, {
        checkoutUrl: stripe.toString(), propertyId,
        message: "Customer and property saved. Hand over the tablet for secure Stripe subscription checkout. No payment has been taken."
      });
    } catch (error) {
      // Best-effort cleanup of incomplete enrolments; never delete an existing user.
      if (propertyId) await admin.from("properties").delete().eq("id", propertyId);
      if (customerId) await admin.from("customers").delete().eq("id", customerId);
      if (userId) await admin.auth.admin.deleteUser(userId);
      throw error;
    }
  } catch (error) { return errorResponse(error); }
});
