exports.handler = async (event) => {
  const { userId } = JSON.parse(event.body || "{}");

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

  const orderRes = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: userId,
          amount: {
            currency_code: "USD",
            value: "1.00",
          },
          description: "100 The Great Canvas credits",
        },
      ],
      application_context: {
        return_url: "https://thegreatcanvas.netlify.app/?paypal=success",
        cancel_url: "https://thegreatcanvas.netlify.app/?paypal=cancel",
      },
    }),
  });

  const orderData = await orderRes.json();
  const approve = orderData.links?.find((l) => l.rel === "approve");

  return {
    statusCode: 200,
    body: JSON.stringify({ url: approve?.href }),
  };
};