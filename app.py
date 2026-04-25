from __future__ import annotations
from collections import deque

import heapq
import time
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


def make_response(success: bool, result: dict | None = None, metrics: dict | None = None, error: str | None = None, status_code: int = 200):
    return jsonify({
        "success": success,
        "result": result if result is not None else {},
        "metrics": metrics if metrics is not None else {},
        "error": error
    }), status_code


def manhattan_distance(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def is_valid_coord(coord: Any) -> bool:
    return (
        isinstance(coord, list)
        and len(coord) == 2
        and all(isinstance(x, int) for x in coord)
    )


def validate_payload(data: Any) -> tuple[bool, str | None]:
    if not isinstance(data, dict):
        return False, "Payload must be a JSON object."

    if "grid" not in data: return False, "Missing required field: grid."
    if "player_coords" not in data: return False, "Missing required field: player_coords."
    if "target_coords" not in data: return False, "Missing required field: target_coords."

    grid = data["grid"]
    player_coords = data["player_coords"]
    target_coords = data["target_coords"]
    
    # We must extract the enemy type to know how to validate the coordinates
    enemy_type = data.get("state_data", {}).get("enemy_type", "")

    if not isinstance(grid, list) or len(grid) == 0:
        return False, "Field 'grid' must be a non-empty 2D list."
    if not all(isinstance(row, list) and len(row) > 0 for row in grid):
        return False, "Field 'grid' must contain non-empty rows."

    rows = len(grid)
    cols = len(grid[0])

    if not is_valid_coord(player_coords):
        return False, "Field 'player_coords' must be a list of two integers [row, col]."
        
    pr, pc = player_coords
    if not (0 <= pr < rows and 0 <= pc < cols):
        return False, "Field 'player_coords' is out of grid bounds."

    # --- THE APEX PATCH: DYNAMIC VALIDATION ---
    if enemy_type == "swarm":
        if not isinstance(target_coords, list):
            return False, "Field 'target_coords' must be a list of coordinates for swarm."
        for coord in target_coords:
            if not is_valid_coord(coord):
                return False, "Invalid coordinate found in swarm payload."
            tr, tc = coord
            if not (0 <= tr < rows and 0 <= tc < cols):
                return False, "Swarm coordinate out of grid bounds."
    else:
        # Standard Single-Entity Validation
        if not is_valid_coord(target_coords):
            return False, "Field 'target_coords' must be a list of two integers [row, col]."
        tr, tc = target_coords
        if not (0 <= tr < rows and 0 <= tc < cols):
            return False, "Field 'target_coords' is out of grid bounds."

    return True, None

def is_walkable_for_hunter(grid: list[list[int]], row: int, col: int, goal: tuple[int, int]) -> bool:
    """
    Walkable rules:
    - 0: normal floor
    - 2: player tile
    - goal tile is always allowed explicitly
    """
    if (row, col) == goal:
        return True
    return grid[row][col] in (0, 2)


def reconstruct_path(came_from: dict[tuple[int, int], tuple[int, int]], start: tuple[int, int], goal: tuple[int, int]) -> list[list[int]]:
    """
    Returns path excluding start, including goal.
    Example:
    start = (5, 5), goal = (5, 7)
    path = [[5, 6], [5, 7]]
    """
    path: list[list[int]] = []
    current = goal

    while current != start:
        path.append([current[0], current[1]])
        current = came_from[current]

    path.reverse()
    return path

def run_astar(grid: list[list[int]], start: tuple[int, int], goal: tuple[int, int]):
    rows, cols = len(grid), len(grid[0])
    start_time = time.perf_counter()
    
    open_heap = []
    tie_breaker = 0
    heapq.heappush(open_heap, (manhattan_distance(start, goal), tie_breaker, start))

    came_from = {start: None}
    g_score = {start: 0}
    nodes_explored = 0
    found = False

    while open_heap:
        current_f, _, current = heapq.heappop(open_heap)
        current_g = g_score.get(current)
        if current_g is None: continue

        nodes_explored += 1

        if current == goal:
            found = True
            break

        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = current[0] + dr, current[1] + dc
            if 0 <= nr < rows and 0 <= nc < cols and is_walkable_for_hunter(grid, nr, nc, goal):
                neighbor = (nr, nc)
                tentative_g = current_g + 1
                if tentative_g < g_score.get(neighbor, float("inf")):
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    tie_breaker += 1
                    f_score = tentative_g + manhattan_distance(neighbor, goal)
                    heapq.heappush(open_heap, (f_score, tie_breaker, neighbor))

    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    path = reconstruct_path(came_from, start, goal) if found else []
    return path, nodes_explored, exec_time


def run_bfs(grid: list[list[int]], start: tuple[int, int], goal: tuple[int, int]):
    """ Breadth-First Search: Blind, expanding flood-fill """
    rows, cols = len(grid), len(grid[0])
    start_time = time.perf_counter()
    
    queue = deque([start])
    came_from = {start: None}
    nodes_explored = 0
    found = False

    while queue:
        current = queue.popleft()
        nodes_explored += 1

        if current == goal:
            found = True
            break

        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = current[0] + dr, current[1] + dc
            if 0 <= nr < rows and 0 <= nc < cols and is_walkable_for_hunter(grid, nr, nc, goal):
                neighbor = (nr, nc)
                # BFS only cares if we have visited it before
                if neighbor not in came_from:
                    came_from[neighbor] = current
                    queue.append(neighbor)

    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    path = reconstruct_path(came_from, start, goal) if found else []
    return path, nodes_explored, exec_time

def run_vector_bfs(grid: list[list[int]], swarm_coords: list[tuple[int, int]], goal: list[int]):
    """ Reverse BFS: Creates a Vector Field from the Player to all tiles """
    rows, cols = len(grid), len(grid[0])
    start_time = time.perf_counter()
    
    # --- BUG FIX: Cast the JSON list to a Python tuple so it can be hashed in the dictionary ---
    player_pos = tuple(goal)
    
    # 1. Reverse BFS from Player to entire board
    queue = deque([player_pos])
    distance = {player_pos: 0}
    nodes_explored = 0

    while queue:
        current = queue.popleft()
        nodes_explored += 1
        curr_dist = distance[current]

        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = current[0] + dr, current[1] + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] in (0, 2):
                neighbor = (nr, nc)
                if neighbor not in distance:
                    distance[neighbor] = curr_dist + 1
                    queue.append(neighbor)
    
    # 2. Evaluate each Grunt's best move based on the Vector Field
    next_moves = []
    for grunt in swarm_coords:
        best_move = grunt
        min_dist = distance.get(grunt, float('inf'))
        
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = grunt[0] + dr, grunt[1] + dc
            neighbor = (nr, nc)
            
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] in (0, 2):
                dist = distance.get(neighbor, float('inf'))
                if dist < min_dist:
                    min_dist = dist
                    best_move = neighbor
        
        next_moves.append([best_move[0], best_move[1]])

    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    return next_moves, nodes_explored, exec_time

def run_dfs(grid: list[list[int]], start: tuple[int, int], goal: tuple[int, int]):
    """ Depth-First Search: Erratic, deep-diving pathfinding """
    rows, cols = len(grid), len(grid[0])
    start_time = time.perf_counter()
    
    # DFS uses a Stack (LIFO - Last In, First Out)
    stack = [start]
    came_from = {start: None}
    nodes_explored = 0
    found = False

    while stack:
        current = stack.pop()
        nodes_explored += 1

        if current == goal:
            found = True
            break

        # Exploring neighbors. The order they are pushed dictates the dive direction.
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = current[0] + dr, current[1] + dc
            if 0 <= nr < rows and 0 <= nc < cols and is_walkable_for_hunter(grid, nr, nc, goal):
                neighbor = (nr, nc)
                if neighbor not in came_from:
                    came_from[neighbor] = current
                    stack.append(neighbor)

    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    path = reconstruct_path(came_from, start, goal) if found else []
    return path, nodes_explored, exec_time

def run_iddfs(grid: list[list[int]], start: tuple[int, int], goal: tuple[int, int], max_depth: int = 5):
    rows, cols = len(grid), len(grid[0])
    start_time = time.perf_counter()
    nodes_explored = 0

    # Phase 2 Patch: Heuristic Fallback Tracking
    best_node = start
    min_dist = manhattan_distance(start, goal)
    best_path_to_node = []

    def dls(current: tuple[int, int], depth: int, visited: set, current_path: list) -> list[tuple[int, int]] | None:
        nonlocal nodes_explored, best_node, min_dist, best_path_to_node
        nodes_explored += 1

        # Evaluate if this node is closer to the goal than anything we've seen
        dist = manhattan_distance(current, goal)
        if dist < min_dist:
            min_dist = dist
            best_node = current
            best_path_to_node = list(current_path)

        if current == goal:
            return current_path

        if depth <= 0:
            return None

        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = current[0] + dr, current[1] + dc
            neighbor = (nr, nc)

            if 0 <= nr < rows and 0 <= nc < cols and is_walkable_for_hunter(grid, nr, nc, goal):
                if neighbor not in visited:
                    visited.add(neighbor)
                    current_path.append(neighbor)
                    
                    result = dls(neighbor, depth - 1, visited, current_path)
                    if result is not None:
                        return result
                        
                    current_path.pop()
                    visited.remove(neighbor)
        return None

    final_path = []
    
    # Run the Iterative Deepening
    for depth in range(1, max_depth + 1):
        path = dls(start, depth, {start}, [])
        if path:
            final_path = [[p[0], p[1]] for p in path]
            break

    # THE APEX PATCH: If the goal is too far, route to the closest known tile
    if not final_path and best_path_to_node:
        final_path = [[p[0], p[1]] for p in best_path_to_node]

    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    return final_path, nodes_explored, exec_time


def evaluate_combat_state(grid: list[list[int]], player_pos: tuple[int, int], enemy_pos: tuple[int, int], depth: int, is_maximizing: bool, alpha: float, beta: float) -> int:
    # Terminal Check: Checkmate by Hunter
    if player_pos == enemy_pos:
        return -100  
        
    if depth == 0:
        escape_routes = 0
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = player_pos[0] + dr, player_pos[1] + dc
            if 0 <= nr < len(grid) and 0 <= nc < len(grid[0]) and grid[nr][nc] in (0, 2):
                escape_routes += 1
        return escape_routes

    if is_maximizing:
        max_eval = float('-inf')
        has_moves = False
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = player_pos[0] + dr, player_pos[1] + dc
            if 0 <= nr < len(grid) and 0 <= nc < len(grid[0]) and grid[nr][nc] in (0, 2):
                has_moves = True
                eval_score = evaluate_combat_state(grid, (nr, nc), enemy_pos, depth - 1, False, alpha, beta)
                max_eval = max(max_eval, eval_score)
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break 
        return max_eval if has_moves else -10 
    else:
        # THE FIX: Simulate the Hunter's actual intercept path
        path, _, _ = run_astar(grid, enemy_pos, player_pos)
        if not path:
            return 100 # Player is safe, Hunter is blocked
            
        next_enemy_pos = tuple(path[0])
        eval_score = evaluate_combat_state(grid, player_pos, next_enemy_pos, depth - 1, True, alpha, beta)
        return eval_score

def run_backtracking_nqueens(n: int):
    """ Backtracking Algorithm: Solves the N-Queens constraint satisfaction problem. """
    start_time = time.perf_counter()
    nodes_explored = 0

    def is_safe(board, row, col):
        # Check this row on left side
        for i in range(col):
            if board[row][i] == 1: return False
        # Check upper diagonal on left side
        for i, j in zip(range(row, -1, -1), range(col, -1, -1)):
            if board[i][j] == 1: return False
        # Check lower diagonal on left side
        for i, j in zip(range(row, n, 1), range(col, -1, -1)):
            if board[i][j] == 1: return False
        return True

    def solve(board, col):
        nonlocal nodes_explored
        nodes_explored += 1
        
        # Base case: If all queens are placed, return true
        if col >= n: return True
        
        # Consider this column and try placing this queen in all rows one by one
        for i in range(n):
            if is_safe(board, i, col):
                board[i][col] = 1 # Place Queen
                
                # Recur to place rest of the queens
                if solve(board, col + 1): return True
                
                # If placing queen in board[i][col] doesn't lead to a solution, BACKTRACK
                board[i][col] = 0 
                
        return False

    # Initialize empty board
    board = [[0] * n for _ in range(n)]
    
    # Run the recursive solver
    solve(board, 0)
    
    # Extract the winning coordinates
    solution_coords = []
    for r in range(n):
        for c in range(n):
            if board[r][c] == 1:
                solution_coords.append([r, c])
                
    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    return solution_coords, nodes_explored, exec_time

# --- 2. THE MASTER DISPATCHER (THE BRAIN) ---

@app.route("/api/v1/enemy/move", methods=["POST"])
def move_enemy():
    data = request.get_json(silent=True)

    is_valid, error_message = validate_payload(data)
    if not is_valid:
        return make_response(success=False, error=error_message, status_code=400)

    grid = data["grid"]
    start = tuple(data["target_coords"])
    goal = tuple(data["player_coords"])
    state_data = data.get("state_data", {})
    enemy_type = state_data.get("enemy_type", "hunter")

    # Routing logic based on enemy type
  # Routing logic based on enemy type
    if enemy_type == "hunter":
        path, nodes, exec_time = run_astar(grid, start, goal)
        algo_name = "A* Search"
        complexity = "O(E log V)"
    elif enemy_type == "grunt":
        path, nodes, exec_time = run_bfs(grid, start, goal)
        algo_name = "Breadth-First Search"
        complexity = "O(V + E)"
    elif enemy_type == "swarm":
        # --- PHASE 2: SWARM INTERCEPTION ---
        # We extract the array of coordinates directly from the payload
        swarm_list = [tuple(c) for c in data["target_coords"]]
        next_moves, nodes, exec_time = run_vector_bfs(grid, swarm_list, goal)
        
        # We return immediately to bypass the single-path logic below
        return make_response(
            success=True,
            result={"next_moves": next_moves},
            metrics={
                "algorithm": "Reverse BFS (Vector Field)",
                "complexity_theoretical": "O(V + E)",
                "nodes_explored": nodes,
                "execution_time_ms": exec_time
            }
        )
    elif enemy_type == "stalker":
        path, nodes, exec_time = run_dfs(grid, start, goal)
        algo_name = "Depth-First Search"
        complexity = "O(V + E)"
    elif enemy_type == "sentinel":
        path, nodes, exec_time = run_iddfs(grid, start, goal)
        algo_name = "Iterative Deepening DFS"
        complexity = "O(b^d)"
    else:
        return make_response(success=False, error="Unknown enemy type.", status_code=400)

    # Global return for single-entity pathfinders
    if not path:
        return make_response(success=False, error=f"No path found for {enemy_type}.")

    return make_response(
        success=True,
        result={"path": path},
        metrics={
            "algorithm": algo_name,
            "complexity_theoretical": complexity,
            "nodes_explored": nodes,
            "path_length": len(path),
            "execution_time_ms": exec_time
        }
    )

@app.route("/api/v1/combat/resolve", methods=["POST"])
def resolve_combat():
    data = request.get_json(silent=True)
    grid = data["grid"]
    player_coords = tuple(data["player_coords"])
    enemy_coords = tuple(data["target_coords"])
    
    start_time = time.perf_counter()
    
    # Run Minimax 3 turns deep to look for traps
    combat_score = evaluate_combat_state(
        grid=grid, 
        player_pos=player_coords, 
        enemy_pos=enemy_coords, 
        depth=3, 
        is_maximizing=True, 
        alpha=float('-inf'), 
        beta=float('inf')
    )
    
    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    
    # If the score is > 0, the player has an escape route and survives the trade.
    # If the score is <= 0, the player is trapped, and the trade is mathematically lethal.
    survivable = combat_score > 0
    
    return make_response(
        success=True,
        result={"survivable": survivable, "score": combat_score},
        metrics={
            "algorithm": "Minimax with Alpha-Beta Pruning",
            "execution_time_ms": exec_time
        }
    )

@app.route("/api/v1/gateway/backtracking", methods=["POST"])
def solve_gateway():
    data = request.get_json(silent=True)
    if not data or "n" not in data:
        return make_response(success=False, error="Missing parameter 'n' for grid size.", status_code=400)
        
    n = int(data["n"])
    
    # Run the Backtracking algorithm
    solution, nodes, exec_time = run_backtracking_nqueens(n)
    
    if not solution:
        return make_response(success=False, error="No solution exists for this dimension.")
        
    return make_response(
        success=True,
        result={"solution": solution},
        metrics={
            "algorithm": "Backtracking Search",
            "complexity_theoretical": "O(N!)",
            "nodes_explored": nodes,
            "execution_time_ms": exec_time
        }
    )
def solve_graph_coloring(graph_edges, num_nodes, num_colors):
    start_time = time.perf_counter()
    nodes_explored = 0
    adj = {i: [] for i in range(num_nodes)}
    for u, v in graph_edges:
        adj[u].append(v)
        adj[v].append(u)
    colors = [-1] * num_nodes

    def is_safe(node, c):
        for neighbor in adj[node]:
            if colors[neighbor] == c: return False
        return True

    def solve(node):
        nonlocal nodes_explored
        nodes_explored += 1
        if node == num_nodes: return True
        for c in range(num_colors):
            if is_safe(node, c):
                colors[node] = c
                if solve(node + 1): return True
                colors[node] = -1
        return False

    success = solve(0)
    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    return colors if success else [], nodes_explored, exec_time

@app.route("/api/v1/gateway/graph-coloring", methods=["POST"])
def graph_coloring_api():
    data = request.get_json(silent=True)
    solution, nodes, exec_time = solve_graph_coloring(data.get("edges", []), data.get("num_nodes", 0), data.get("num_colors", 3))
    return make_response(success=True, result={"solution": solution}, metrics={"algorithm": "Backtracking (Graph)", "nodes_explored": nodes, "execution_time_ms": exec_time})

# --- BLOCK 2: BAYESIAN THREAT RADAR ---
def calculate_threat_radar(grid: list[list[int]], player_pos: tuple[int, int], traps: list[list[int]]) -> dict:
    pr, pc = player_pos
    adjacent_tiles = [(pr-1, pc), (pr+1, pc), (pr, pc-1), (pr, pc+1)]
    
    total_floor_tiles = sum(row.count(0) for row in grid)
    if total_floor_tiles == 0: return {"threat_level": 0.0, "status": "CLEAR"}
    
    p_trap = len(traps) / total_floor_tiles
    adjacent_traps = sum(1 for r, c in adjacent_tiles if [r, c] in traps)
    
    p_sensor_given_trap = 0.95 
    p_sensor_given_no_trap = 0.10 
    
    if adjacent_traps > 0:
        p_sensor = (p_sensor_given_trap * p_trap) + (p_sensor_given_no_trap * (1 - p_trap))
        posterior_prob = (p_sensor_given_trap * p_trap) / p_sensor
        threat_score = round(posterior_prob * 100 * adjacent_traps, 1)
        status = "CRITICAL" if threat_score > 50 else "ELEVATED"
    else:
        threat_score = round(p_trap * 10, 1) 
        status = "CLEAR"

    return {"threat_level": threat_score, "status": status}

@app.route("/api/v1/environment/radar", methods=["POST"])
def environment_radar():
    data = request.get_json(silent=True)
    grid = data.get("grid", [])
    player_coords = data.get("player_coords", [])
    traps = data.get("traps", [])
    
    start_time = time.perf_counter()
    radar_data = calculate_threat_radar(grid, tuple(player_coords), traps)
    exec_time = round((time.perf_counter() - start_time) * 1000, 4)
    
    return make_response(success=True, result={"radar": radar_data}, metrics={"algorithm": "Bayesian Network (P(A|B))", "execution_time_ms": exec_time})
# --- BLOCK 3: FUZZY INFERENCE SYSTEM ---
@app.route("/api/v1/system/fuzzy", methods=["POST"])
def fuzzy_scaling():
    data = request.get_json(silent=True)
    time_ms = data.get("time_ms", 30000)
    hp = data.get("hp", 3)
    
    # 1. Fuzzification & Rule Evaluation
    time_sec = time_ms / 1000.0
    
    if time_sec <= 15.0 and hp == 3:
        profile = {"state": "BRUTAL", "trap_count": 8, "hunter_throttle": False}
    elif time_sec >= 45.0 or hp <= 1:
        profile = {"state": "MERCY", "trap_count": 2, "hunter_throttle": True}
    else:
        profile = {"state": "STANDARD", "trap_count": 5, "hunter_throttle": False}
        
    return make_response(
        success=True, 
        result={"profile": profile}, 
        metrics={"algorithm": "Fuzzy Logic Controller"}
    )

# --- BLOCK 4: GENETIC ALGORITHM BOSS ---
import string
import random

def fitness_score(chromosome: str, target: str) -> int:
    return sum(1 for a, b in zip(chromosome, target) if a == b)

@app.route("/api/v1/gateway/genetic", methods=["POST"])
def genetic_algorithm():
    data = request.get_json(silent=True)
    target_cipher = data.get("target", "GRIMOIRE")
    pop_size = 50
    mutation_rate = 0.10
    
    # 1. Initialize Random Population
    population = [''.join(random.choices(string.ascii_uppercase, k=len(target_cipher))) for _ in range(pop_size)]
    
    generations_data = []
    
    for gen in range(100): # Max generations safeguard
        # 2. Grade Fitness
        population = sorted(population, key=lambda x: fitness_score(x, target_cipher), reverse=True)
        best_chromosome = population[0]
        best_score = fitness_score(best_chromosome, target_cipher)
        
        generations_data.append({"gen": gen, "best": best_chromosome, "score": best_score})
        
        if best_score == len(target_cipher):
            break
            
        # 3. Selection & Crossover
        next_gen = population[:10] # Keep top 10 fittest
        while len(next_gen) < pop_size:
            p1, p2 = random.choices(population[:20], k=2)
            split = random.randint(1, len(target_cipher)-1)
            child = p1[:split] + p2[split:]
            next_gen.append(child)
            
        # 4. Mutation
        population = []
        for chromo in next_gen:
            if random.random() < mutation_rate:
                idx = random.randint(0, len(chromo)-1)
                chromo = chromo[:idx] + random.choice(string.ascii_uppercase) + chromo[idx+1:]
            population.append(chromo)

    return make_response(success=True, result={"evolution": generations_data}, metrics={"algorithm": "Genetic Algorithm"})

if __name__ == "__main__":
    app.run(debug=True, port=5000)