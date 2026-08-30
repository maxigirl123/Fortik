import { X402_FACILITATOR_URL } from "./constants.js";
import { fetchWithTimeout } from "./services/httpClient.js";

const PRICE_USD = process.env.PRICE_USD ?? "0.01";
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS ?? "0xYOUR_WALLET_ADDRESS_HERE";
const NETWORK = process.env.X402_NETWORK ?? "base";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? X402_FACILITATOR_URL;

export const PAYMENT_REQUIREMENTS = {
  scheme: "exact",
  network: NETWORK,
  maxAmountRequired: `$${PRICE_USD}`,
  payTo: PAY_TO_ADDRESS,
  resource: "/mcp",
  description: "Storefront legitimacy pre-purchase check"
} as const;

export function build402Challenge() {
  return {
    x402Version: 1,
    accepts: [PAYMENT_REQUIREMENTS]
  };
}

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason: string | null;
}

interface FacilitatorSettleResponse {
  success: boolean;
  txHash: string;
  networkId: string;
}

export async function verifyAndSettlePayment(
  paymentHeader: string | undefined
): Promise<{ paid: boolean; txHash?: string }> {
  if (!paymentHeader) return { paid: false };

  const facilitatorBody = {
    x402Version: 1,
    paymentHeader,
    paymentRequirements: PAYMENT_REQUIREMENTS
  };

  try {
    const verifyRes = await fetchWithTimeout(`${FACILITATOR_URL}/verify`, undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facilitatorBody)
    });
    if (!verifyRes.ok) return { paid: false };

    const verifyData = (await verifyRes.json()) as FacilitatorVerifyResponse;
    if (!verifyData.isValid) return { paid: false };

    const settleRes = await fetchWithTimeout(`${FACILITATOR_URL}/settle`, undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facilitatorBody)
    });
    if (!settleRes.ok) return { paid: false };

    const settleData = (await settleRes.json()) as FacilitatorSettleResponse;
    if (!settleData.success) return { paid: false };

    return { paid: true, txHash: settleData.txHash };
  } catch {
    return { paid: false };
  }
}
