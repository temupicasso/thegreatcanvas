const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const { orderId } = JSON.parse(event.body || "{}");

  console.log("ORDER ID:", orderId);

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

  console.log("TOKEN OK:", !!tokenData.access_token);

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

  console.log("CAPTURE DATA:", JSON.stringify(captureData));

  if (captureData.status !== "COMPLETED") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Payment not completed", captureData }),
    };
  }

  const userId = captureData.purchase_units?.[0]?.custom_id;

  console.log("USER ID:", userId);

  if (!userId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing userId", captureData }),
    };
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("credits")
    .eq("id", userId)
    .single();

  console.log("SUPABASE USER:", JSON.stringify(user));
  console.log("SUPABASE USER ERROR:", JSON.stringify(userError));

  if (userError || !user) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "User not found", userId, userError }),
    };
  }

  const newCredits = (user.credits || 0) + 100;

  const { error: updateError } = await supabase
    .from("users")
    .update({ credits: newCredits })
    .eq("id", userId);

  console.log("UPDATE ERROR:", JSON.stringify(updateError));
  console.log("NEW CREDITS:", newCredits);

  if (updateError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Could not update credits", updateError }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ credits: newCredits }),
  };
};