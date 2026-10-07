# Lagos Rush Competitive Stakes: Future Module Note

**Status: not built.** Version 1 has no real money wagering, no deposits, no withdrawals, no cash prizes and no way for players to send money to one another. Naira in the game is play money. This note records the constraints a future regulated module would have to meet, so that nothing built now makes it harder to do properly later, and so that nobody bolts on an informal version.

## Why it is separate

The user's brief is explicit: skip in game skill based competitions with wagers for now, never build an informal peer to peer betting system, and never let players pay each other directly. Real money competitions sit under gaming law, payments law and anti money laundering rules. They need a licensed operator, audited systems and a compliance team. None of that belongs inside a racing client.

## The regulatory picture in Nigeria (as researched on 7 October 2026)

* On 22 November 2024 the Supreme Court held, in a suit led by Lagos State (SC/1/2008), that lotteries and gaming are residual matters for the states, so the federal National Lottery Act no longer applies within them. Its reach remains in the Federal Capital Territory.
* In Lagos the regulator is the Lagos State Lotteries and Gaming Authority, under the Lagos State Lotteries and Gaming Authority Law 2021 and its guidelines.
* Whether online gaming that crosses state lines falls to each state, and how skill based contests are classified, are still argued.
* The National Assembly passed a Central Gaming Bill in December 2025 that would centralise regulation. Reports say the President signalled he would not sign it, and a June 2026 guide says it remained unsigned.

This changes often. Any real build starts with fresh advice from Nigerian gaming counsel.

Sources: [PwC Nigeria on the Supreme Court verdict](https://www.pwc.com/ng/en/assets/pdf/supreme-court-verdict-on-the-national-lottery-act.pdf); [Aluko and Oyebode on the 2024 ruling](https://www.aluko-oyebode.com/insights/nigeria-lottery-act-supreme-court-ruling-2024/); [iGaming Business on the Central Gaming Bill](https://igamingbusiness.com/legal-compliance/nigeria-central-gambling-bill-rejected-state-regulators/); [Mondaq, a 2026 guide for operators](https://www.mondaq.com/nigeria/gaming/1807818/navigating-nigerias-new-gaming-laws-a-2026-regulatory-guide-for-sports-betting-and-casino-operators).

## What a future module would need

| Area | Minimum |
|---|---|
| Licence | A licence from each state regulator where players take part, starting with Lagos, or a licensed operator partner who holds them |
| Who can play | 18 and over, identity verified (KYC), location checked against licensed states |
| Money | Held by a licensed payment provider in segregated accounts; never by the game server; no player to player transfers |
| Contest design | Server authoritative races only, fixed entry fees and prize tables published before entry, the house fee shown plainly |
| Integrity | Anti cheat stronger than v1's validation, replays kept as evidence, collusion detection across accounts, a dispute process |
| Responsible play | Deposit and loss limits, cool off and self exclusion, reality checks, links to support services |
| Compliance | AML monitoring and reporting, audit logs that cannot be edited, data protection under the Nigeria Data Protection Act |
| Separation | Its own service, its own accounts and wallet, its own deployment. The racing game calls it; it never lives inside the game |

## What version 1 already does that helps later

* Results come only from the server; the host can never change a result, physics or rewards.
* Races are deterministic enough to replay: traffic from the seed, item rolls from seeded hashes, the server's simulation is the record.
* Player state from clients is validated against physics and impossible moves are ignored and counted.
* Rooms are instanced and self contained, so a regulated room type could be added beside them.

## What version 1 deliberately does not do

* No real currency, no purchase of Naira, no cash out.
* No contests with entry fees, no prize pools, no odds, no betting on races or players.
* No player to player transfers of anything with value.
