# FairFare

**One shopping trip, planned to the cent, for a household on SNAP.**
The LLM proposes meals, the user chooses, and an integer solver guarantees the cart fits the budget.

## The problem

A SNAP balance has to last until the next deposit. Most meal apps hand you recipes and a rough cost. What a family actually needs at the register is different: which meals this trip, exactly which packages to buy, what goes on the EBT card versus the debit card, and whether this trip leaves enough for the weeks after it. Getting that wrong means a declined card or an empty fridge on day five.

## What FairFare does

1. **Five-question setup**: people, deposit date and balance, cash on hand, diet, kitchen equipment and time.
2. **A guaranteed plan**: eight or so real recipes for the trip, every meal slot covered, the SNAP cap never exceeded, and a "pace" line ("on pace to Oct 10" or "runs out Oct 3") from the balance and deposit date.
3. **Real prices**: every ingredient carries a Kroger listing price with its source URL. Walmart and ALDI prices were gathered the same way, and the app compares the same plan across the three stores, with the nearest branch by ZIP.
4. **Your kitchen counts**: photograph a shelf and the vision model turns it into pantry levels you confirm; the cart shrinks to what you actually need. Leftovers roll into the next trip.
5. **At the register**: a full-screen "Swipe EBT first $47.20, then card $6.10" so the split is never a surprise.
6. **You stay in charge**: heart recipes into a cookbook the planner leans toward, add or remove recipes, and the planner explains every change in one exact sentence.

## How it's built

| Layer | Choice | Why |
|---|---|---|
| Planner | **OR-Tools CP-SAT**, all-integer model | Budgets, coverage and package math are hard constraints, not suggestions |
| Recipes, pantry photos | OpenAI gpt-4o-mini (text and vision), through one `llm.py` module | The LLM proposes; it never touches money |
| Prices | kroger.com listings with provenance; Walmart and ALDI via a web-search model, size-checked, URL per row | No estimated prices, ever; unmatched items are left out, not guessed |
| Locations | OpenStreetMap (Nominatim + Overpass) | Nearest branch and distance, free and keyless |
| Photos | gpt-image-1-mini, one per recipe, labelled as illustrations | |
| API | FastAPI, Pydantic schemas as the single contract | Same field names front to back |
| App | React + Vite + TypeScript, plain CSS, installable web app | Runs on any phone with no store install |

**Inside the solver.** Integer variables for how many times each meal is cooked and how many packages of each ingredient to buy. Hard constraints: SNAP spend under the trip's cap, cash spend under cash on hand, every breakfast, lunch and dinner slot covered, grams used never exceed grams bought plus pantry, variety floors and repeat ceilings. Soft targets for calories, protein, fibre, sodium and sugar. A pacing cap spreads the SNAP balance across the days until the deposit. When the money truly cannot cover everything, the solver relaxes rules in a fixed order (variety, then repeats, then coverage) and reports exactly what it could not do, instead of failing. Pinned recipes, saved favourites and an opt-in "let my card cover what SNAP can't" are all constraints or objective terms, so they're honoured mathematically, not by prompt. Solves run in 50 to 400 ms.

## Why not just ask an LLM?

We measured it. Same household, same real prices, nine runs each:

| Method | Ingredients bought short | Nutrition targets met | Time |
|---|---|---|---|
| Plain LLM plan | 5.6 per plan | 2.8 of 5 | 4.0 s |
| FairFare (LLM + solver) | 0 | 4.0 of 5 | 0.06 s |

The LLM writes appealing meals but routinely plans food it never buys. The solver closes that gap every time.

## Honesty choices judges should know about

- Prices are online listing prices and the app says so; per-store shelf prices need the Kroger API, whose client is already written.
- Every balance screen says "Entered manually, not connected to your EBT account."
- Pantry photos yield levels (full, half, low) the user confirms; grams are estimates and are labelled.
- Recipe photos are AI illustrations and are labelled.
- Nutrition is shown as "met" or "85% of target." Nothing grades a food or a person.

## Built in 33 hours

Spec first (a 900-line design document with non-negotiables such as "all solver math is integers" and "never invent prices"), then phase gates each proven on a phone before the next began. Backend tests run after every solver change (33 pass). Parallel coding agents built screens against fixed component contracts while the solver and data work happened alongside. Every step is a tagged commit, so the demo state is reproducible.

## Next

Per-location prices and stock through the Kroger API; Publix; a chat agent that uses the solver as a tool for requests like "I've got $40 this time and the oven's broken"; a notification the day before the deposit.
