
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = "BABsuwYDpv_LkOIzj01MvRj-DWPTc5ttaoTCdLylMEdxylSr7nLXkGEZuMZVLdxmRyMwXY2cALkAKXBv244FBWY";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function markOnce(key: string, type: string, customerId?: string | null, jobId?: string | null) {
  const { error } = await admin.from("notification_log").insert({
    notification_key: key,
    notification_type: type,
    customer_id: customerId ?? null,
    job_id: jobId ?? null
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

async function sendOwnerPush(payload: Record<string, unknown>) {
  const { data: secretRow, error: secretError } = await admin
    .from("integration_secrets")
    .select("secret_value")
    .eq("name", "owner_push_vapid_private")
    .maybeSingle();
  if (secretError) throw secretError;
  if (!secretRow?.secret_value) throw new Error("Push private key is not configured.");

  webpush.setVapidDetails("mailto:adamglover561@gmail.com", VAPID_PUBLIC, secretRow.secret_value);

  const { data: subs, error } = await admin
    .from("owner_push_subscriptions")
    .select("id,endpoint,p256dh,auth");
  if (error) throw error;

  let sent = 0;
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 300, urgency: "high" }
      );
      sent++;
    } catch (err: any) {
      const status = Number(err?.statusCode ?? err?.status ?? 0);
      console.error("Push send failed", status, err?.message ?? err);
      if (status === 404 || status === 410) {
        await admin.from("owner_push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
  return sent;
}


/**
 * Owner email is an independent delivery channel. A push notification can have
 * zero subscribers, so its notification log must never suppress an email.
 * Replayed requests use a stable Resend idempotency key and a separate log key.
 */
async function sendOwnerEmailForJob(event: string, jobId: string): Promise<boolean> {
  const notificationKey = "owner-email:" + event + ":" + jobId;
  const { data: existing, error: existingError } = await admin
    .from("notification_log").select("notification_key").eq("notification_key", notificationKey).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return false;

  const { data: job, error: jobError } = await admin.from("jobs")
    .select("id,customer_id,property_id,title,description,created_at,booking_source")
    .eq("id", jobId).maybeSingle();
  if (jobError) throw jobError;
  if (!job || job.booking_source !== "customer") throw new Error("Job missing or not customer-submitted");

  const [customerResult, propertyResult] = await Promise.all([
    admin.from("customers").select("id,full_name,email,phone").eq("id", job.customer_id).maybeSingle(),
    admin.from("properties").select("id,address_line1,address_line2,town_city,postcode")
      .eq("id", job.property_id).maybeSingle()
  ]);
  if (customerResult.error) throw customerResult.error;
  if (propertyResult.error) throw propertyResult.error;
  const customer = customerResult.data;
  const property = propertyResult.data;
  if (!customer || !property) throw new Error("Owner alert missing customer or property");

  const keyFromEnv = Deno.env.get("RESEND_API_KEY");
  const { data: keyRow, error: keyError } = keyFromEnv ? { data: null, error: null } :
    await admin.from("integration_secrets").select("secret_value")
      .eq("name", "resend_transactional_api_key").maybeSingle();
  if (keyError) throw keyError;
  const apiKey = keyFromEnv || keyRow?.secret_value;
  if (!apiKey) throw new Error("Owner email Resend credential not configured");

  const urgent = event === "breakdown_requested" && String(job.title || "").startsWith("URGENT CALL-OUT");
  const label = urgent ? "URGENT CALL-OUT" : event === "booking_requested" ? "NEW APPOINTMENT REQUEST" : "NEW BREAKDOWN REQUEST";
  const address = [property.address_line1, property.address_line2, property.town_city, property.postcode]
    .filter(Boolean).join(", ");
  const contactFromRequest = String(job.description || "").match(/^Contact phone:\\s*(.+)$/m)?.[1]?.trim();
  const content = [
    "Property Care 360 — " + label,
    "",
    "Customer: " + String(customer.full_name || "Unknown"),
    "Customer email: " + String(customer.email || "Not provided"),
    "Contact phone: " + String(contactFromRequest || customer.phone || "Not provided"),
    "Property: " + address,
    "Request: " + String(job.title || ""),
    "Submitted: " + String(job.created_at || ""),
    "",
    "Details:",
    String(job.description || "No additional details."),
    "",
    "Status: Awaiting your response",
    "Review: https://propertycare360.co.uk/admin/",
    "Job ID: " + jobId,
    "",
    "For urgent safety issues, contact the customer promptly. This email is a notification, not confirmation of an attended visit."
  ].join("\\n");

  const requestHeaders = {
    "Authorization": "Bearer " + apiKey,
    "Content-Type": "application/json",
    "Idempotency-Key": "pc360-owner-" + event + "-" + jobId
  };
  const requestBody = JSON.stringify({
    from: "Property Care 360 <membership@propertycare360.co.uk>",
    to: ["adamglover561@gmail.com"],
    subject: label + " — Property Care 360",
    text: content
  });
  let sent = false;
  let lastStatus = "unavailable";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: requestHeaders, body: requestBody
      });
      if (response.ok) { sent = true; break; }
      lastStatus = "HTTP " + response.status;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : "network error";
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (!sent) throw new Error("Owner alert email failed: " + lastStatus);

  const { error: logError } = await admin.from("notification_log").insert({
    notification_key: notificationKey,
    notification_type: "owner_email_" + event,
    customer_id: job.customer_id,
    job_id: jobId
  });
  if (logError && logError.code !== "23505") throw logError;
  return true;
}

async function getUserFromBearer(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { header, token: "", user: null };
  const token = header.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  if (error) return { header, token, user: null };
  return { header, token, user: data.user ?? null };
}

async function handleRequest(req: Request) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { header, token, user } = await getUserFromBearer(req);
  const isServiceRole = token === SERVICE_ROLE;

  try {
    if (body.action === "test") {
      if (!user) return new Response("Unauthorized", { status: 401 });
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: header } },
        auth: { persistSession: false }
      });
      const { data: isAdmin, error } = await userClient.rpc("is_home_care_admin");
      if (error || isAdmin !== true) return new Response("Forbidden", { status: 403 });
      const sent = await sendOwnerPush({
        title: "Property Care 360 alerts are on",
        body: "You will now receive customer activity alerts on this device.",
        url: "/admin/"
      });
      return Response.json({ ok: true, sent });
    }

    if (body.action === "internal-event") {
      if (!isServiceRole) return new Response("Forbidden", { status: 403 });
      const event = String(body.event ?? "");
      const id = String(body.id ?? crypto.randomUUID());
      const allowed = new Set(["payment_paid","payment_failed","subscription_canceled","subscription_updated"]);
      if (!allowed.has(event)) return new Response("Unsupported event", { status: 400 });
      const fresh = await markOnce("owner-push:" + event + ":" + id, "owner_push_" + event);
      if (!fresh) return Response.json({ ok: true, duplicate: true });
      const labels: Record<string,string> = {
        payment_paid: "Customer payment received",
        payment_failed: "Customer payment failed",
        subscription_canceled: "Customer membership cancelled",
        subscription_updated: "Customer membership changed"
      };
      const sent = await sendOwnerPush({
        title: "Property Care 360",
        body: labels[event],
        url: "/admin/"
      });
      return Response.json({ ok: true, sent });
    }

    if (body.action !== "customer-event") return new Response("Unsupported action", { status: 400 });
    if (!user) return new Response("Unauthorized", { status: 401 });

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return new Response("Customer profile not found", { status: 403 });

    const event = String(body.event ?? "");
    const id = String(body.id ?? "");
    let title = "Property Care 360";
    let pushBody = "New customer activity. Open the admin app to view details.";
    let jobId: string | null = null;

    if (event === "customer_signup") {
      if (id !== customer.id) return new Response("Forbidden", { status: 403 });
      title = "New Property Care 360 customer";
      pushBody = "A customer account has been created.";
    } else if (event === "property_added") {
      const { data: row, error } = await admin.from("properties").select("id,customer_id").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!row || row.customer_id !== customer.id) return new Response("Forbidden", { status: 403 });
      title = "New property added";
      pushBody = "A customer added a property to Property Care 360.";
    } else if (event === "breakdown_requested" || event === "booking_requested") {
      const { data: row, error } = await admin.from("jobs").select("id,customer_id,booking_source,title").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!row || row.customer_id !== customer.id || row.booking_source !== "customer") return new Response("Forbidden", { status: 403 });
      jobId = row.id;
      title = event === "breakdown_requested" ? "New breakdown request" : "New appointment request";
      pushBody = event === "breakdown_requested"
        ? "A customer has requested a breakdown visit."
        : "A customer has requested an appointment.";
      if (event === "breakdown_requested" && String(row.title ?? "").startsWith("URGENT CALL-OUT")) {
        title = "URGENT CALL-OUT — Property Care 360";
        pushBody = "An urgent plumbing or heating call-out needs your attention. Open the owner app to view details and call the customer.";
      }
    } else if (event === "account_deletion_requested") {
      const { data: row, error } = await admin.from("account_deletion_requests").select("id,customer_id").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!row || row.customer_id !== customer.id) return new Response("Forbidden", { status: 403 });
      title = "Account deletion request";
      pushBody = "A customer has requested account deletion.";
    } else {
      return new Response("Unsupported customer event", { status: 400 });
    }

    // Email is independent of push deduplication. Previously a push with zero
    // registered devices still counted as sent, silently losing the alert.
    const emailSent = jobId && (event === "breakdown_requested" || event === "booking_requested")
      ? await sendOwnerEmailForJob(event, jobId) : false;

    const fresh = await markOnce("owner-push:" + event + ":" + id, "owner_push_" + event, customer.id, jobId);
    if (!fresh) return Response.json({ ok: true, duplicate: true, emailSent });

    const sent = await sendOwnerPush({ title, body: pushBody, url: "/admin/" });
    return Response.json({ ok: true, sent, emailSent });
  } catch (err: any) {
    console.error(err);
    return new Response("Owner alert processing failed", { status: 500 });
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const response = await handleRequest(req);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
});
