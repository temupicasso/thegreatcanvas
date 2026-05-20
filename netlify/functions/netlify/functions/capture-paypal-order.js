const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const { orderId } = JSON.parse(event.body || "{}");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const base =
    process.env.PAYPAL_ENV === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const tokenData = await tokenRes.json();

  const captureRes = await fetch(
    `${base}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const captureData = await captureRes.json();

  if (captureData.status !== "COMPLETED") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Payment not completed" }),
    };
  }

  const userId = captureData.purchase_units?.[0]?.custom_id;

  const { data: user } = await supabase
    .from("users")
    .select("credits")
    .eq("id", userId)
    .single();

  const newCredits = (user?.credits || 0) + 100;

  await supabase
    .from("users")
    .update({ credits: newCredits })
    .eq("id", userId);

  return {
    statusCode: 200,
    body: JSON.stringify({ credits: newCredits }),
  };
};