
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const adminKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!adminKey) throw new Error("Supabase admin key unavailable");

const supabase = createClient(url, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function notifyOwner(event: string, id: string) {
  try {
    const response = await fetch(`${url}/functions/v1/owner-push`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${adminKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "internal-event", event, id })
    });
    if (!response.ok) console.error("Owner push failed", response.status, await response.text());
  } catch (error) {
    console.error("Owner push failed", error);
  }
}

function getId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function isoFromUnix(value: unknown): string | null {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function mapSubStatus(value: unknown): string {
  const allowed = new Set([
    "pending","trialing","active","past_due","paused","canceled",
    "unpaid","incomplete","incomplete_expired"
  ]);
  const s = typeof value === "string" ? value : "pending";
  return allowed.has(s) ? s : "pending";
}

async function verifyStripeSignature(body: string, header: string, secret: string) {
  const parts = header.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`))
  );
  const expected = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");

  for (const candidate of signatures) {
    if (candidate.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) {
      diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

async function processCheckoutCompleted(session: Record<string, any>) {
  const ref = session.client_reference_id as string | null;
  if (!ref || !ref.startsWith("hc_") || !ref.includes("__")) return;

  const [customerPart, propertyId] = ref.slice(3).split("__");
  const customerId = customerPart;
  if (!customerId || !propertyId) return;

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id, customer_id")
    .eq("id", propertyId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (propertyError) throw propertyError;
  if (!property) throw new Error("Checkout reference does not match a valid customer/property");

  const stripeCustomerId = getId(session.customer);
  const stripeSubscriptionId = getId(session.subscription);
  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw new Error("Stripe checkout missing customer or subscription");
  }

  const { error: customerError } = await supabase
    .from("customers")
    .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
    .eq("id", customerId).is("stripe_customer_id", null);
  if (customerError) throw customerError;

  const subscriptionStatus =
    session.payment_status === "paid" || session.payment_status === "no_payment_required"
      ? "active"
      : "pending";

  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .upsert({
      customer_id: customerId,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      status: subscriptionStatus,
      updated_at: new Date().toISOString()
    }, { onConflict: "stripe_subscription_id" })
    .select("id")
    .single();
  if (subError) throw subError;

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, monthly_price_pence")
    .eq("code", (() => {
      const amount = typeof session.amount_total === "number" ? session.amount_total : null;
      const inferred = amount === 4400
        ? "home_care_additional_2_4"
        : amount === 3900
          ? "home_care_additional_5_plus"
          : "home_care_first_property";
      const code = String(session.metadata?.plan_code || inferred);
      return ["home_care_first_property","home_care_additional_2_4","home_care_additional_5_plus"].includes(code)
        ? code
        : inferred;
    })())
    .single();
  if (planError) throw planError;

  const { error: coverError } = await supabase
    .from("property_cover")
    .upsert({
      subscription_id: sub.id,
      property_id: propertyId,
      plan_id: plan.id,
      monthly_price_pence: plan.monthly_price_pence,
      discount_percent: plan.monthly_price_pence === 4400 ? 10.20 : plan.monthly_price_pence === 3900 ? 20.41 : 0,
      active: true
    }, { onConflict: "subscription_id,property_id" });
  if (coverError) throw coverError;

  const { error: dueError } = await supabase
    .from("properties")
    .update({
      next_boiler_service_due: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0,10),
      updated_at: new Date().toISOString()
    })
    .eq("id", propertyId)
    .is("next_boiler_service_due", null);
  if (dueError) throw dueError;

  const { error: plumbingDueError } = await supabase
    .from("properties")
    .update({
      next_plumbing_check_due: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0,10),
      updated_at: new Date().toISOString()
    })
    .eq("id", propertyId)
    .is("next_plumbing_check_due", null);
  if (plumbingDueError) throw plumbingDueError;

  const amount = typeof session.amount_total === "number" ? session.amount_total : plan.monthly_price_pence;
  const bill = {
    customer_id: customerId,
    property_id: propertyId,
    stripe_checkout_session_id: session.id,
    stripe_invoice_id: getId(session.invoice),
    record_type: "subscription",
    amount_pence: amount,
    currency: session.currency || "gbp",
    status: subscriptionStatus === "active" ? "paid" : "pending",
    description: "Property Care 360 subscription signup"
  };
  const invoiceId = getId(session.invoice);
  const filter = "stripe_checkout_session_id.eq."+session.id + (invoiceId ? ",stripe_invoice_id.eq."+invoiceId : "");
  const {data: updatedBill, error: updateError} = await supabase.from("billing_records")
    .update({...bill,updated_at:new Date().toISOString()}).or(filter).select("id").maybeSingle();
  if(updateError)throw updateError;
  if(!updatedBill){
    const {error: billingError}=await supabase.from("billing_records").insert(bill);
    if(billingError)throw billingError;
  }
}

async function processInvoice(invoice: Record<string, any>, paid: boolean) {
  const stripeCustomerId = getId(invoice.customer);
  const stripeSubscriptionId = getId(invoice.parent?.subscription_details?.subscription) || getId(invoice.subscription);
  if (!stripeCustomerId) return;

  // Payment Links can create a separate Stripe customer for each property.
  // Resolve recurring invoices by subscription before using the latest customer ID.
  let subscriptionDbId: string | null = null;
  let customerId: string | null = null;
  if (stripeSubscriptionId) {
    const { data: sub, error } = await supabase.from("subscriptions")
      .select("id,customer_id").eq("stripe_subscription_id", stripeSubscriptionId).maybeSingle();
    if (error) throw error;
    subscriptionDbId = sub?.id ?? null;
    customerId = sub?.customer_id ?? null;
    if (!sub && invoice.parent?.subscription_details?.metadata?.app === "property_care_365") {
      throw new Error("Subscription checkout is not processed yet; retry invoice");
    }
    if (sub) {
      const { error: statusError } = await supabase.from("subscriptions")
        .update({ status: paid ? "active" : "past_due", updated_at: new Date().toISOString() })
        .eq("id", sub.id);
      if (statusError) throw statusError;
    }
  }
  if (!customerId) {
    const { data: customer, error } = await supabase.from("customers")
      .select("id").eq("stripe_customer_id", stripeCustomerId).maybeSingle();
    if (error) throw error;
    customerId = customer?.id ?? null;
  }
  if (!customerId) return;

  let propertyId: string | null = null;
  if (subscriptionDbId) {
    const { data: cover, error: coverError } = await supabase
      .from("property_cover")
      .select("property_id")
      .eq("subscription_id", subscriptionDbId)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (coverError) throw coverError;
    propertyId = cover?.property_id ?? null;
  }

  const amount = paid
    ? (typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0)
    : (typeof invoice.amount_due === "number" ? invoice.amount_due : 0);

  const { data: existingBill, error: existingBillError } = await supabase
    .from("billing_records")
    .update({
      amount_pence: amount,
      currency: invoice.currency || "gbp",
      status: paid ? "paid" : "failed",
      invoice_sync_status: "sent",
      hosted_invoice_url: invoice.hosted_invoice_url || null,
      updated_at: new Date().toISOString()
    })
    .eq("stripe_invoice_id", invoice.id)
    .select("id")
    .maybeSingle();
  if (existingBillError) throw existingBillError;
  if (existingBill) return;

  const { error: billError } = await supabase.from("billing_records").insert({
    customer_id: customerId,
    property_id: propertyId,
    stripe_invoice_id: invoice.id,
    record_type: "subscription",
    amount_pence: amount,
    currency: invoice.currency || "gbp",
    status: paid ? "paid" : "failed",
    invoice_sync_status: "sent",
    description: paid ? "Property Care 360 subscription payment" : "Property Care 360 subscription payment failed",
    hosted_invoice_url: invoice.hosted_invoice_url || null
  });
  if (billError && billError.code !== "23505") throw billError;
}

async function processSubscription(obj: Record<string, any>, forceCanceled = false) {
  const stripeSubscriptionId = obj.id as string | undefined;
  if (!stripeSubscriptionId) return;

  const firstItem = obj.items?.data?.[0];
  const periodStart = obj.current_period_start ?? firstItem?.current_period_start ?? null;
  const periodEnd = obj.current_period_end ?? firstItem?.current_period_end ?? null;

  const { data: updated, error } = await supabase
    .from("subscriptions")
    .update({
      status: forceCanceled ? "canceled" : mapSubStatus(obj.status),
      current_period_start: isoFromUnix(periodStart),
      current_period_end: isoFromUnix(periodEnd),
      cancel_at_period_end: Boolean(obj.cancel_at_period_end),
      updated_at: new Date().toISOString()
    })
    .eq("stripe_subscription_id", stripeSubscriptionId).select("id");
  if (error) throw error;
  if (!updated?.length && obj.metadata?.app === "property_care_365") throw new Error("Checkout must be processed before subscription update");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });

  const body = await req.text();

  const { data: secretRow, error: secretError } = await supabase
    .from("integration_secrets")
    .select("secret_value")
    .eq("name", "stripe_webhook_signing_secret")
    .maybeSingle();

  if (secretError) return new Response("Secret lookup failed", { status: 500 });
  if (!secretRow?.secret_value) return new Response("Webhook secret not configured", { status: 503 });

  const valid = await verifyStripeSignature(body, signature, secretRow.secret_value);
  if (!valid) return new Response("Invalid signature", { status: 400 });

  let event: Record<string, any>;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventId = event.id as string | undefined;
  const eventType = event.type as string | undefined;
  if (!eventId || !eventType) return new Response("Invalid event", { status: 400 });

  const { error: eventInsertError } = await supabase
    .from("stripe_events")
    .insert({ event_id: eventId, event_type: eventType });

  if (eventInsertError?.code === "23505") {
    return Response.json({ ok: true, duplicate: true });
  }
  if (eventInsertError) return new Response("Idempotency check failed", { status: 500 });

  try {
    const obj = event.data?.object as Record<string, any>;
    switch (eventType) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await processCheckoutCompleted(obj);
        break;
      case "invoice.paid":
        await processInvoice(obj, true);
        await notifyOwner("payment_paid", eventId);
        break;
      case "invoice.payment_failed":
        await processInvoice(obj, false);
        await notifyOwner("payment_failed", eventId);
        break;
      case "customer.subscription.updated":
        await processSubscription(obj, false);
        break;
      case "customer.subscription.deleted":
        await processSubscription(obj, true);
        await notifyOwner("subscription_canceled", eventId);
        break;
      default:
        break;
    }
    return Response.json({ ok: true });
  } catch (err) {
    await supabase.from("stripe_events").delete().eq("event_id", eventId);
    console.error(err);
    return new Response("Webhook processing failed", { status: 500 });
  }
});


