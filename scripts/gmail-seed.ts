// Puts synthetic customer emails into a TEST Gmail inbox (no sending: messages.insert drops them straight in).
// Usage: npm run gmail:seed -- 5        (first 5 emails)   |   npm run gmail:seed -- e01 e21 e43
import { labeledEmails } from "../src/sources/mock.ts";
import { b64url, gmail, rfc822 } from "../src/sources/gmail-api.ts";

const args = process.argv.slice(2);
const picked = args.length === 0 || /^\d+$/.test(args[0])
  ? labeledEmails.slice(0, Number(args[0] ?? 5))
  : labeledEmails.filter((e) => args.includes(e.id));

for (const e of picked) {
  const raw = rfc822(
    {
      From: `${e.from_name} <${e.from_email}>`,
      To: "support@kettleandpine.example",
      Subject: e.subject,
      Date: new Date().toUTCString(),
      "Message-ID": `<${e.id}.${Date.now()}@demo.kettleandpine.example>`,
    },
    e.body,
  );
  await gmail("/messages?internalDateSource=receivedTime", { method: "POST", body: { raw: b64url(raw), labelIds: ["INBOX", "UNREAD"] } });
  console.log(`Inserted ${e.id}: ${e.subject}`);
}
