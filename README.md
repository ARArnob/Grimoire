# 🌌 Grimoire: The Algorithmic Abyss

[![Python](https://img.shields.io/badge/Backend-Python_3.8+-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![Flask](https://img.shields.io/badge/Framework-Flask-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![JavaScript](https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Grimoire: The Algorithmic Abyss** is a matrix-based survival game that serves as a live demonstration of diverse Artificial Intelligence algorithms. Players must navigate a $15 \times 15$ grid, evading lethal entities governed by various pathfinding heuristics, solving constraint-satisfaction puzzles, and ultimately defeating a terminal boss driven by a Genetic Evolution algorithm.

---

## 🛠️ Technical Architecture

The project utilizes a **Decoupled Client-Server Architecture** to separate high-intensity heuristic computations from the UI rendering thread.

* **Frontend:** Vanilla JavaScript, CSS Grid (Matrix Logic), and Flexbox (UI Layout).
* **Backend:** Python Flask REST API for real-time pathfinding and state evaluation.
* **Communication:** Asynchronous `fetch` API with JSON payloads.

---

## 🧠 The AI Ecosystem (Heuristic Deep-Dive)

Every entity in the Abyss is driven by a unique algorithmic profile:

| Entity | Algorithm | Computational Logic |
| :--- | :--- | :--- |
| **Apex Hunter** | **A* Search** | Optimal pathfinding using Manhattan Distance heuristics. |
| **The Swarm** | **Reverse BFS** | Uses a Vector Field to coordinate group interception. |
| **The Phantom** | **Stateful DFS** | Erratic, deep-diving movement for unpredictable flanking. |
| **The Warden** | **IDDFS** | Territorial defense using Iterative Deepening with a tethered radius. |
| **Combat** | **Minimax** | Resolves trades using Alpha-Beta Pruning (3-turn lookahead). |

### Advanced Systems
* **Bayesian Threat Radar:** Calculates the posterior probability of hidden traps using a Bayesian Network based on sensor inputs.
* **Fuzzy Logic Scaling:** A Fuzzy Inference System (FIS) analyzes player HP and clear times to modulate the next floor's lethality (Mercy, Standard, or Brutal).
* **Genetic Evolution Boss:** The final floor is sealed by a mutating cipher. Players must trigger a Genetic Algorithm to evolve a target chromosome via Selection, Crossover, and Mutation.

---

## 🔐 Cryptographic Gateways

To descend deeper, players must solve procedural puzzles that manifest as Gateway Locks:
1.  **N-Queens Problem:** A backtracking-based constraint satisfaction puzzle that scales in dimension as the player progresses.
2.  **Graph Coloring:** A network-based cryptographic lock requiring nodes to be colored without adjacency conflicts.

---

## 🚀 Local Setup & Installation

To run the Abyss on your local machine, you must execute both the compute engine and the interface.

### 1. Initialize Compute Engine (Backend)
```bash
# Navigate to the project root
cd Grimoire

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Launch Flask Server
python app.py
```

### 2. Launch Interface (Frontend)
Simply open `index.html` in any modern web browser. The engine is configured to automatically detect the local environment and handshake with `127.0.0.1:5000`.

---

## 🕹️ Controls
* **WASD / Arrows:** Matrix Navigation.
* **E:** Deploy Temporal Stasis (Freezes AI event loops for 3 turns).
* **Enter:** Initiate Gateway Hack (When standing on the goal).

---

## 📜 Project Structure
```text
├── app.py              # Flask Backend (Heuristic Dispatcher)
├── game.js             # Core Engine (DOM Rendering & State Management)
├── levels.js           # Matrix Configurations & Terrain Data
├── index.html          # UI Shell & Modal Definitions
├── style.css           # Grid & Flexbox Architectures
└── requirements.txt    # Python Dependency Manifest
```

---

**Developed as a 6th Semester Capstone Project.**
