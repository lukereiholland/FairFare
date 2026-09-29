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


The CP-SAT solver handles constraints such as:

* SNAP spending limits
* cash spending limits
* pantry inventory
* ingredient package quantities
* dietary restrictions
* meal-slot coverage
* variety and repetition limits
* nutrition targets
* user-selected recipes

Benchmark

We compared FairFare’s hybrid AI + optimization approach against a plain-LLM baseline across 9 evaluation runs.

## Benchmark

We compared FairFare's hybrid AI + optimization approach against a plain-LLM baseline across 9 evaluation runs.

| Metric | Plain LLM | FairFare Hybrid |
|---|---:|---:|
| Ingredient-sufficiency violations per plan | 5.6 | 0 |
| Average nutrition targets met | 2.8 / 5 | 4.0 / 5 |
| Meal slots covered | 100% | 100% |
| Plans over budget | 0% | 0% |
| Mean evaluation time | 4.0 s | 56 ms |

The hybrid system eliminated ingredient-sufficiency violations while improving nutrition-target satisfaction and preserving budget and meal-coverage constraints.

> Note: the hybrid benchmark reused a cached candidate meal pool and measured the optimization stage fresh on each run.

Features

* SNAP-aware budgeting
* Cash and EBT spending separation
* Multimodal pantry detection
* Voice-based grocery input
* AI-assisted recipe generation
* Deterministic meal-plan optimization
* Nutrition-aware constraints
* Grocery-store price comparison
* Pantry carryover between shopping trips
* ZIP-based nearby store lookup
* Recipe favorites and cookbook
* Responsive web interface

Tech Stack

Frontend

* React
* TypeScript
* Vite
* CSS

Backend

* Python
* FastAPI
* Pydantic

Optimization

* Google OR-Tools
* CP-SAT

AI

* OpenAI models
* vision input
* generative recipe support
* ElevenLabs speech-to-text

Data and Location

* retailer price datasets
* OpenStreetMap
* Nominatim
* Overpass

Testing

* Pytest
* FastAPI API tests
* solver evaluation harness

Project Structure

api/        FastAPI application and endpoints
data/       ingredients, meals, and retailer pricing datasets
eval/       baseline and hybrid evaluation code
stretch/    optimization, AI, pantry, nutrition, pricing, and location logic
tests/      solver, pantry, pricing, and store tests
web/        React + TypeScript frontend

Core Design Principle

FairFare deliberately avoids using an LLM for exact financial decisions.

Large language models are used for tasks where flexibility is useful, such as:

* interpreting pantry contents
* generating meal ideas
* understanding natural-language input

The optimization engine handles tasks that require exact guarantees, including:

* budget compliance
* ingredient sufficiency
* meal coverage
* package quantities
* nutrition constraints

This separation makes the system more reliable than using a generative model alone.

Team

FairFare was built collaboratively during a hackathon by a student team focused on improving access to affordable and nutritious food.

Future Work

* live per-location retailer pricing and inventory
* additional SNAP-participating retailers
* native iOS and Android applications
* expanded user testing with SNAP recipients
* conversational planning using the optimizer as a tool
