# FairFare

AI-powered grocery optimization for SNAP-aware meal planning.

FairFare combines multimodal AI with deterministic constraint optimization to help households plan affordable, nutritious meals around SNAP benefits, cash budgets, pantry inventory, dietary needs, and real grocery prices.

Live demo: https://ffare.tech

## What FairFare Does

Users can build a household profile using information such as:

- SNAP balance and cash budget
- household size
- dietary restrictions
- nutrition goals
- available kitchen equipment
- cooking-time preferences
- pantry inventory
- location

FairFare then generates meal options and builds a grocery plan that accounts for what the household already owns, which items are SNAP-eligible, and how much each purchase will cost.

Pantry inventory can be entered manually, through voice input, or from a pantry image.

## Why We Built It

Meal planning is already time-consuming when budget constraints are loose. For households relying on SNAP benefits, planning becomes a constrained optimization problem involving:

- limited benefits
- cash spending limits
- package sizes
- dietary requirements
- nutritional targets
- pantry inventory
- meal coverage
- retailer pricing

Rather than asking a large language model to perform exact budget calculations, FairFare separates open-ended AI tasks from deterministic optimization.

The AI proposes and interprets.

The solver guarantees the constraints.

## Architecture

FairFare uses a hybrid architecture:

```text
React + TypeScript frontend
        |
        v
FastAPI + Pydantic API
        |
        +------------------------------+
        |                              |
        v                              v
Multimodal AI                    Structured data layer
- pantry vision                 - ingredients
- text parsing                  - meals
- speech input                  - retailer prices
- recipe generation             - SNAP eligibility
        |                              |
        +--------------+---------------+
                       |
                       v
              Google OR-Tools CP-SAT
                       |
                       v
             Optimized grocery plan
                       |
        +--------------+---------------+
        |                              |
        v                              v
Store comparison                React UI
OpenStreetMap                   meal plan/cart
