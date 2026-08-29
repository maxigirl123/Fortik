import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";
import { runVerification } from "./dist/tools/verifyStorefront.js";

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, ".env"), "utf8").split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] ??= rest.join("=").trim();
}

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_TEST_KEY);

const tools = [
  {
    name: "verify_storefront",
    description: "Checks whether a merchant storefront is legitimate before committing payment. Must be called before make_payment.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Bare domain of the merchant, e.g. 'nike.com'" }
      },
      required: ["domain"]
    }
  },
  {
    name: "make_payment",
    description: "Submits payment to the merchant. Only call this if verify_storefront returned proceed.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant domain" },
        amount_usd: { type: "number", description: "Amount to charge in USD" },
        description: { type: "string", description: "Purchase description" }
      },
      required: ["merchant", "amount_usd", "description"]
    }
  }
];

const system = `You are an AI shopping agent with a payment card on file.

Rules you must follow on every purchase:
1. Always call verify_storefront on the merchant domain first.
2. If recommendation is "proceed" → call make_payment to complete the purchase.
3. If recommendation is "pause_for_confirmation" → stop and explain to the user what you found. Do not call make_payment.
4. If recommendation is "do_not_proceed" → block the transaction entirely. Do not call make_payment. Explain every signal that triggered the block.

Never summarize the signals away — always list them explicitly.`;

async function handleToolCall(toolName, input) {
  if (toolName === "verify_storefront") {
    const { domain } = input;
    console.log(`${DIM}  → calling verify_storefront("${domain}")...${RESET}\n`);

    const { result } = await runVerification(domain);

    const recColor =
      result.recommendation === "proceed" ? GREEN
      : result.recommendation === "pause_for_confirmation" ? YELLOW
      : RED;

    console.log(`  ${BOLD}VERDICT${RESET}  ${recColor}${BOLD}${result.recommendation.toUpperCase()}${RESET}`);
    console.log(`  ${DIM}${result.recommendationReason}${RESET}`);
    console.log(`  Trust score ${BOLD}${result.trustScore}/100${RESET}  ·  Risk: ${result.riskLevel}  ·  Confidence: ${result.confidence}\n`);
    console.log(`  ${BOLD}Signals${RESET}`);
    result.reasons.forEach((r) => console.log(`    ${DIM}·${RESET} ${r}`));
    console.log();

    return JSON.stringify(result);
  }

  if (toolName === "make_payment") {
    const { merchant, amount_usd, description } = input;
    const amountCents = Math.round(amount_usd * 100);

    console.log(`${DIM}  → submitting payment to Stripe...${RESET}\n`);

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method: "pm_card_visa",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `${description} (merchant: ${merchant})`
    });

    console.log(`  ${GREEN}${BOLD}PAYMENT CONFIRMED${RESET}`);
    console.log(`  Amount   $${amount_usd.toFixed(2)}`);
    console.log(`  Merchant ${merchant}`);
    console.log(`  ID       ${intent.id}`);
    console.log(`  Status   ${intent.status}\n`);

    return JSON.stringify({ status: intent.status, id: intent.id, amount_usd });
  }
}

async function runAgent(task) {
  console.log(`\n${CYAN}${BOLD}AGENT TASK${RESET}  "${task}"\n`);

  const messages = [{ role: "user", content: task }];

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system,
      tools,
      messages
    });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length > 0) {
      const results = [];
      for (const block of toolUseBlocks) {
        const output = await handleToolCall(block.name, block.input);
        results.push({ type: "tool_result", tool_use_id: block.id, content: output });
      }
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: results });
    } else {
      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      console.log(`${BOLD}Agent:${RESET} ${text}\n`);
      break;
    }
  }
}

const task = process.argv.slice(2).join(" ");
if (!task) {
  console.error(`Usage: node demo-agent.mjs "buy running shoes from nike.com for $49.99"`);
  process.exit(1);
}

await runAgent(task);
