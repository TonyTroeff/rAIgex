---
name: regex-deep-dive
description: Explain, construct, and simulate Thompson NFAs for core regex syntax, including wildcards, shorthand categories, character classes, ranges, and negation, with small examples and visualizer-ready JSON.
---

# Regex Deep Dive

## Goal

Make a regex understandable as a machine. For each question, show the smallest useful **parse → NFA → input trace**. Focus on what each operator changes; avoid lengthy theory and giant diagrams.

## Supported syntax

| Syntax | Meaning |
| --- | --- |
| `a`, `\.` | Literal character; escaping makes a metacharacter literal |
| `AB`, `A|B`, `(A)` | Concatenation, choice, grouping |
| `A*`, `A+`, `A?` | Zero or more, one or more, zero or one |
| `.` | One character matched by the configured wildcard policy |
| `\d`, `\w`, `\s` | Digit, word character, whitespace |
| `\D`, `\W`, `\S` | Negations of those three sets |
| `[abc]`, `[a-z]`, `[a-z0-9_]` | One character from a class, possibly with ranges |
| `[^abc]`, `[^a-z]`, `[^\d]` | One character **not** in the class |

**Declare the character semantics before tracing:**

- Choose a character universe `Σ` (use ASCII for simple examples unless the user or app specifies otherwise). Negation is always relative to `Σ`.
- Under the ASCII convention: `\d = [0-9]`; `\w = [A-Za-z0-9_]`; `\s` is space, tab, line feed, carriage return, form feed, or vertical tab. `\D`, `\W`, and `\S` are their complements.
- `.` is one character, not an ε-transition. In typical engine-style mode it excludes line terminators unless dot-all is enabled; in formal “any symbol” mode it matches every character in `Σ`. State which mode is used.
- A class matches **exactly one** character. Its items are a union; a leading unescaped `^` complements the entire union. Inside a class, `\d`, `\w`, and `\s` contribute their character sets. Escaped `\-` and `\^` can denote literal characters.
- Negation here applies to **character sets**, not whole regexes. Do not treat lookaheads such as `(?!...)` as character-class negation.

Unsupported by default: anchors (`^`, `$` outside classes), boundaries (`\b`), lookarounds, backreferences, counted repetition (`{m,n}`), lazy/possessive quantifiers, and engine-specific flags or Unicode rules. If a pattern requires one, explain the limitation instead of silently dropping it or changing the regex.

## Parse first

Precedence, highest to lowest: **postfix** `* + ?`, then **concatenation**, then **alternation** `|`. Parentheses override it.

- `ab*` means `a(b*)`, not `(ab)*`.
- `ab|c` means `(ab)|c`, not `a(b|c)`.
- `[ab]*` repeats a *single-character class*; `(ab)*` repeats a two-character group.

Show a fully parenthesized form when the grouping is not obvious.

## Build the Thompson NFA

A **fragment** has one start and one exit. A transition labeled `ε` consumes nothing; a consuming transition tests one character against a **matcher**. Use fresh states for wrapper operators and connect fragments with explicit ε-edges.

| Expression | Construction |
| --- | --- |
| Literal, `.`, shorthand, or class | Two states with one edge carrying its matcher |
| `ε` | Two states joined by an ε-edge |
| `AB` | Add `A.exit --ε--> B.start`; start is `A.start`, exit is `B.exit` |
| `A|B` | Fresh start branches by ε to both starts; both exits ε-connect to a fresh exit |
| `A*` | Fresh start ε-connects to `A.start` and the fresh exit; `A.exit` ε-connects back to `A.start` and to the fresh exit |
| `A+` | As for `A*`, **without** the start-to-exit skip edge |
| `A?` | As for `A*`, **without** the loop-back edge |

Only the whole NFA's exit is accepting. Assign state IDs when states are created (children first, wrappers afterward), and do not renumber in a trace. These conventions give two states per consuming atom and two fresh states for each alternation or repetition wrapper; concatenation adds no states. For example, `(a|b)*abb` has **14 states** under these conventions, not 11.

A wildcard, shorthand, or class is **one symbolic edge**, not hundreds of expanded character edges. This keeps the diagram small without changing the accepted language.

## Worked example: `ab*` on `abb`

Parse: `a(b*)`. Allocate the `a` fragment (`0,1`), the `b` fragment (`2,3`), then the star wrapper (`4,5`). Start = `0`; accept = `5`.

```text
0 --a--> 1 --ε--> 4
4 --ε--> 2 --b--> 3
4 --ε--> 5
3 --ε--> 2      (repeat)
3 --ε--> 5      (finish)
```

At every step, take the **ε-closure**: all states reachable without consuming a character.

| Read | Active states after ε-closure | Accept active? |
| --- | --- | --- |
| start | `{0}` | no |
| `a` | `{1,2,4,5}` | yes |
| `b` | `{2,3,5}` | yes |
| `b` | `{2,3,5}` | yes |

Accept `abb` because state `5` is active when the input ends. The machine also accepts `a` and rejects `b`.

For character predicates, a similarly short test is `.[^\d]\w` on `@X7`: the dot matches `@`, the negated class matches non-digit `X`, and `\w` matches `7`. In ASCII, `@37` fails because the second character is a digit. Test `\s` with a literal space or tab, and test `\S` with the same character to demonstrate the inverse.

## Visualizer JSON

Preserve readable labels **and** executable matcher semantics. `matcher: null` means ε; it is never the same as “any character.” Treat `nodeId` as the parse-tree node responsible for an atomic fragment.

```json
{
  "regex": ".[^\\d]\\w",
  "alphabet": "ASCII",
  "dotAll": false,
  "start": 0,
  "accept": [5],
  "states": [
    {"id": 0, "nodeId": "dot"}, {"id": 1, "nodeId": "dot"},
    {"id": 2, "nodeId": "class"}, {"id": 3, "nodeId": "class"},
    {"id": 4, "nodeId": "word"}, {"id": 5, "nodeId": "word"}
  ],
  "transitions": [
    {"from": 0, "to": 1, "label": ".", "matcher": {"kind": "any"}},
    {"from": 1, "to": 2, "label": null, "matcher": null},
    {"from": 2, "to": 3, "label": "[^\\d]", "matcher": {"kind": "class", "negated": true, "items": [{"kind": "category", "name": "digit"}]}},
    {"from": 3, "to": 4, "label": null, "matcher": null},
    {"from": 4, "to": 5, "label": "\\w", "matcher": {"kind": "category", "name": "word", "negated": false}}
  ],
  "trace": {
    "input": "@X7",
    "steps": [
      {"read": null, "active": [0]},
      {"read": "@", "active": [1, 2]},
      {"read": "X", "active": [3, 4]},
      {"read": "7", "active": [5]}
    ],
    "accepted": true
  }
}
```

**Matcher kinds:**

- `{"kind":"literal","value":"a"}` — exactly one character.
- `{"kind":"any"}` — one character under `dotAll` and `alphabet` rules.
- `{"kind":"category","name":"digit","negated":false}` — category names are `digit`, `word`, or `space` for `\d`, `\w`, and `\s`; set `negated:true` for uppercase shorthand.
- `{"kind":"class","negated":false,"items":[...]}` — union of `literal`, `range` (`{"kind":"range","from":"a","to":"z"}`), or `category` matchers. Set `negated:true` for `[^...]`. A negated category inside a class is also allowed if the parser supports it.

Class evaluation: compute union membership of `items` for the current character, then invert if `negated`. Use actual matcher objects for simulation, never parse UI labels to decide which transitions fire.

## Explain and validate

1. Show the parse and any character-universe / newline assumptions.
2. Construct fragments bottom-up; identify start, exit, and consuming vs. ε-edges.
3. Trace **sets** of active states: start ε-closure, then matching moves followed by ε-closure after each character.
4. Accept only when input is exhausted **and** an accept state is active. An inactive branch dying does not reject other branches.
5. Check edge cases: empty input for `*` and `?`, one-or-more for `+`, precedence, ranges, negated classes, and newline behavior for `.`.

If useful, contrast the systematic Thompson NFA with a smaller equivalent NFA, but do not confuse removing ε-edges with minimizing the automaton. If asked about NFA-to-regex, briefly describe state elimination; keep the main focus on construction and simulation.
