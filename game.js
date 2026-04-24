class GrimoireEngine {
    constructor() {
        this.boardSize = 15;
        this.gameBoard = document.getElementById('game-board');
        this.playerToken = document.getElementById('player-token');
        this.hunterToken = document.getElementById('hunter-token');
        this.goalToken = document.getElementById('goal-token');
        this.gruntToken = document.getElementById('grunt-token');
        this.stalkerToken = document.getElementById('stalker-token');
        this.sentinelToken = document.getElementById('sentinel-token');
        this.stasisToken = document.getElementById('stasis-token')

        // Automatically switch between Local and Production APIs
        this.apiBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://127.0.0.1:5000' 
            : 'https://your-backend-name.onrender.com'; // We will get this URL in Phase 2

        this.runMetrics = {};
        this.activeTimerInterval = null;
        this.levelStartTime = 0;
        
        this.levelOrder = Object.keys(GRIMOIRE_LEVELS); 
        this.currentLevelIndex = 0;
        this.maxUnlockedLevelIndex = 0; // Tracks highest achieved floor
        this.selectedDifficulty = 'medium';
        
        this.areEnemiesMoving = false;
        this.isGameOver = false;
        this.isLevelCleared = false; 
        this.playerTurnCount = 0; 
        this.queuedMove = null;
        this.maxHP = 3;
        this.threatProfile = { state: "STANDARD", trap_count: 5, hunter_throttle: false };
        this.currentHP = this.maxHP;

        this.init();
    }

    init() {
        this.bindMenu();
        this.bindInputs();

        document.getElementById('restart-button').addEventListener('click', () => {
            if (this.isLevelCleared) {
                this.advanceLevel();
            } else {
                this.resetGame();
            }
        });

        // NEW: The Quick Restart Button in the Sidebar
        document.getElementById('quick-restart-btn').addEventListener('click', () => {
            this.resetGame();
        });

        // NEW: Matrix Codex Controller
        document.getElementById('open-codex-btn').addEventListener('click', () => {
            document.getElementById('codex-modal').classList.remove('hidden');
        });
        document.getElementById('close-codex-btn').addEventListener('click', () => {
            document.getElementById('codex-modal').classList.add('hidden');
        });

        document.getElementById('retreat-gateway-btn').addEventListener('click', () => {
            this.retreatFromGateway();
        });

        this.updateLevelDropdown();
        this.loadLevel(this.levelOrder[this.currentLevelIndex]);
    }

    loadLevel(levelKey) {
        const levelData = GRIMOIRE_LEVELS[levelKey];
        if (!levelData) return;

        this.terrain = levelData.terrain.map(row => [...row]);
        
        this.playerCoords = [...levelData.playerStart];
        this.hunterCoords = [...levelData.hunterStart];
        this.goalCoords = [...levelData.goalStart];
        this.swarmCoords = levelData ? [...levelData.swarmStart] : [];
        this.stalkerCoords = [...levelData.stalkerStart];
        this.stalkerMemory = [];
        this.sentinelCoords = [...levelData.sentinelStart];
        this.sentinelOriginalCoords = [...levelData.sentinelStart];

        this.areEnemiesMoving = false;
        this.isGameOver = false;
        this.isLevelCleared = false;
        this.playerTurnCount = 0;
        this.queuedMove = null;
        this.currentHP = this.maxHP;
        // Block 2 States
        this.stasisCharges = 0;
        this.stasisActiveTurns = 0;
        document.getElementById('hud-stasis').textContent = '0';
        document.getElementById('hud-radar').textContent = 'CLEAR (0.0%)';
        document.getElementById('hud-radar').style.color = '#a1a1aa';
        
        // Generate Traps & Stasis for Floor 3+
        this.traps = [];
        this.stasisItemCoord = [-1, -1];
        if (this.currentLevelIndex >= 2) {
            this.generateEnvironmentHazards();
        }

        document.getElementById('hud-hp').textContent = `${this.currentHP}/${this.maxHP}`;
        document.getElementById('level-select').value = levelKey;
        document.getElementById('game-over-modal').classList.add('hidden');

        clearInterval(this.activeTimerInterval);
        this.levelStartTime = 0;
        document.getElementById('hud-timer').textContent = "00:00.0";

        this.buildStaticBoard();
        this.renderEntities();
        // --- DYNAMIC LORE INJECTION ---
        const tacticalTips = [
            "[APEX TIP]: Stasis halts event loops. Kinetic hazards remain lethal. Ramming frozen entities drains Vitality.",
            "[APEX TIP]: The Swarm evaluates global fields. They are weak alone, but fatal when they encircle you.",
            "[APEX TIP]: Sentinels are tethered to a tight radius. Breach their territory, and they will execute you.",
            "[APEX TIP]: Threat Radar calculates hidden probability. A spiked percentage means an invisible trap is adjacent.",
            "[APEX TIP]: Tactical retreats are valid. You cannot out-calculate the Apex Hunter in an open corridor.",
            "[APEX TIP]: Cryptographic Gateways lock down the matrix. Ensure you are not being hunted before initiating a hack."
        ];
        const tipElement = document.querySelector('.lore-tip');
        if (tipElement) {
            tipElement.textContent = tacticalTips[Math.floor(Math.random() * tacticalTips.length)];
        }
    }
    generateEnvironmentHazards() {
        const walkable = [];
        
        // 1. Scan the matrix and collect all valid floor tiles
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                // Must be floor (0), strictly not near the player, and not on the goal
                if (this.terrain[r][c] === 0 && 
                   (Math.abs(r - this.playerCoords[0]) + Math.abs(c - this.playerCoords[1]) > 3) && 
                   !(r === this.goalCoords[0] && c === this.goalCoords[1])) {
                    walkable.push([r, c]);
                }
            }
        }
        
        // 2. OUTSIDE THE LOOP: Shuffle the collected tiles
        walkable.sort(() => 0.5 - Math.random());
        
        // 3. Assign Stasis and Traps dynamically based on the Fuzzy Logic profile
        if (walkable.length > this.threatProfile.trap_count + 1) {
            this.stasisItemCoord = walkable.pop();
            for(let i = 0; i < this.threatProfile.trap_count; i++) {
                this.traps.push(walkable.pop());
            }
        }
    }

    async updateThreatRadar() {
        if (this.currentLevelIndex < 2) return; // No traps on Floor 1 & 2
        
        const payload = { grid: this.terrain, player_coords: this.playerCoords, traps: this.traps };
        const res = await fetch(`${this.apiBaseUrl}/api/v1/environment/radar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        
        if (data.success) {
            const radarUI = document.getElementById('hud-radar');
            radarUI.textContent = `${data.result.radar.status} (${data.result.radar.threat_level}%)`;
            radarUI.style.color = data.result.radar.status === 'CRITICAL' ? '#ef4444' : data.result.radar.status === 'ELEVATED' ? '#f59e0b' : '#a1a1aa';
        }
    }

    async advanceLevel() {
        if (this.currentLevelIndex < this.levelOrder.length - 1) {
            // Fuzzy Logic Call
            const lastRunTime = this.runMetrics[this.levelOrder[this.currentLevelIndex]] || 30000;
            try {
                const res = await fetch(`${this.apiBaseUrl}/api/v1/system/fuzzy`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ time_ms: lastRunTime, hp: this.currentHP })
                });
                const data = await res.json();
                if (data.success) {
                    this.threatProfile = data.result.profile;
                    console.log(`Fuzzy Engine Matrix Shift: ${this.threatProfile.state}`);
                }
            } catch (e) { console.error("Fuzzy Engine offline."); }

            // Progression Unlock Logic
            this.currentLevelIndex++;
            if (this.currentLevelIndex > this.maxUnlockedLevelIndex) {
                this.maxUnlockedLevelIndex = this.currentLevelIndex;
            }
            
            this.updateLevelDropdown();
            this.loadLevel(this.levelOrder[this.currentLevelIndex]);
        } else {
            this.resetGame(); 
        }
    }
    
    resetGame() {
        this.loadLevel(this.levelOrder[this.currentLevelIndex]);
    }

    bindMenu() {
        document.getElementById('level-select').addEventListener('change', (e) => {
            const selectedKey = e.target.value;
            this.currentLevelIndex = this.levelOrder.indexOf(selectedKey);
            this.loadLevel(selectedKey);
        });

        document.getElementById('difficulty-select').addEventListener('change', (e) => {
            this.selectedDifficulty = e.target.value;
            this.resetGame();
        });
    }
    updateLevelDropdown() {
        const select = document.getElementById('level-select');
        Array.from(select.options).forEach((option, index) => {
            if (index > this.maxUnlockedLevelIndex) {
                option.disabled = true;
                option.style.color = '#4b5563'; // Greyed out
            } else {
                option.disabled = false;
                option.style.color = ''; // Default active color
            }
        });
        select.value = this.levelOrder[this.currentLevelIndex];
    }
    buildStaticBoard() {
        this.gameBoard.innerHTML = '';
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                if (this.terrain[r][c] === 1) cell.classList.add('wall');
                this.gameBoard.appendChild(cell);
            }
        }
    }

    renderEntities() {
        // Render or Hide Stasis Item
        if (this.stasisItemCoord && this.stasisItemCoord[0] !== -1) {
            this.stasisToken.style.display = 'block';
            this.stasisToken.style.gridRowStart = this.stasisItemCoord[0] + 1;
            this.stasisToken.style.gridColumnStart = this.stasisItemCoord[1] + 1;
        } else if (this.stasisToken) {
            this.stasisToken.style.display = 'none';
        }

        this.playerToken.style.gridRowStart = this.playerCoords[0] + 1;
        this.playerToken.style.gridColumnStart = this.playerCoords[1] + 1;

        this.goalToken.style.gridRowStart = this.goalCoords[0] + 1;
        this.goalToken.style.gridColumnStart = this.goalCoords[1] + 1;

        if (this.hunterCoords[0] !== -1) {
            this.hunterToken.style.display = 'block';
            this.hunterToken.style.gridRowStart = this.hunterCoords[0] + 1;
            this.hunterToken.style.gridColumnStart = this.hunterCoords[1] + 1;
        } else {
            this.hunterToken.style.display = 'none';
        }

        if (this.sentinelCoords[0] !== -1) {
            this.sentinelToken.style.display = 'block';
            this.sentinelToken.style.gridRowStart = this.sentinelCoords[0] + 1;
            this.sentinelToken.style.gridColumnStart = this.sentinelCoords[1] + 1;
        } else {
            this.sentinelToken.style.display = 'none'; // The missing link that caused the ghost
        }

        this.gruntToken.style.display = 'none'; 
        document.querySelectorAll('.dynamic-swarm').forEach(t => t.remove()); 
        
        this.swarmCoords.forEach(coord => {
            if (coord[0] !== -1) {
                const token = this.gruntToken.cloneNode(true); 
                token.removeAttribute('id');
                token.classList.add('dynamic-swarm');
                token.style.display = 'block';
                token.style.gridRowStart = coord[0] + 1;
                token.style.gridColumnStart = coord[1] + 1;
                this.gruntToken.parentNode.appendChild(token);
            }
        });

        if (this.stalkerCoords[0] !== -1) {
            this.stalkerToken.style.display = 'block';
            this.stalkerToken.style.gridRowStart = this.stalkerCoords[0] + 1;
            this.stalkerToken.style.gridColumnStart = this.stalkerCoords[1] + 1;
        } else {
            this.stalkerToken.style.display = 'none';
        }
    }

    movePlayer(dRow, dCol) {
        if (this.isGameOver) return;

        if (this.areEnemiesMoving) {
            this.queuedMove = [dRow, dCol];
            return;
        }

        const newRow = this.playerCoords[0] + dRow;
        const newCol = this.playerCoords[1] + dCol;

        // 1. Terrain Boundary Check
        if (
            newRow >= 0 && newRow < this.boardSize &&
            newCol >= 0 && newCol < this.boardSize &&
            this.terrain[newRow][newCol] === 0
        ) {
            // 2. Strict Lethality Check (Did you walk INTO any enemy?)
            const targetCell = this.getSharedGrid()[newRow][newCol];
            if (targetCell === 3 || targetCell === 6) { 
                this.showGameEnd('GAME OVER', 'You stepped into a fatal trap.');
                return;
            }

            // 3. Execute Valid Move
            this.playerCoords = [newRow, newCol];
            this.playerTurnCount++; 
            this.renderEntities();

            // 4. Timer Logic
            if (this.playerTurnCount === 1 && this.levelStartTime === 0) {
                this.levelStartTime = Date.now();
                this.activeTimerInterval = setInterval(() => {
                    const elapsed = Date.now() - this.levelStartTime;
                    document.getElementById('hud-timer').textContent = this.formatTime(elapsed);
                }, 100);
            }

            // 5. Win Condition
            if (newRow === this.goalCoords[0] && newCol === this.goalCoords[1]) {
                this.triggerGatewayLock(); // The router will handle the Boss vs. Puzzle logic
                return;
            }

            // 5.5 Environment Checks
            if (this.stasisItemCoord[0] === newRow && this.stasisItemCoord[1] === newCol) {
                this.stasisCharges++;
                this.stasisItemCoord = [-1, -1];
                document.getElementById('hud-stasis').textContent = this.stasisCharges;
            }
            if (this.traps.some(t => t[0] === newRow && t[1] === newCol)) {
                this.currentHP--;
                document.getElementById('hud-hp').textContent = `${this.currentHP}/${this.maxHP}`;
                this.traps = this.traps.filter(t => t[0] !== newRow || t[1] !== newCol); // Remove trap
                if (this.currentHP <= 0) { this.showGameEnd('GAME OVER', 'You triggered a Bayesian Trap.'); return; }
            }
            this.updateThreatRadar();

            // 6. Trigger Enemy AI
            this.requestEnemyPaths();
        }
    }

    // --- NEW: PARALLEL DISPATCHER LOGIC ---
   async requestEnemyPaths() {
        if (this.areEnemiesMoving) return;
        this.areEnemiesMoving = true;

        try {
            const pRow = this.playerCoords[0];
            const pCol = this.playerCoords[1];
            
            // --- THE PRE-EMPTIVE STRIKE ---
            let enemyDefeated = false;
            
            for (let i = 0; i < this.swarmCoords.length; i++) {
                if (this.swarmCoords[i][0] === pRow && this.swarmCoords[i][1] === pCol) {
                    enemyDefeated = true;
                    this.swarmCoords[i] = [-1, -1]; 
                    break; 
                }
            }

            if (this.stalkerCoords[0] === pRow && this.stalkerCoords[1] === pCol) {
                enemyDefeated = true;
                this.stalkerCoords = [-1, -1]; 
            }

            // --- STASIS CORE LOGIC (MOVED) ---
            let skipEnemyMovement = false;
            if (this.stasisActiveTurns > 0) {
                this.stasisActiveTurns--;
                if (this.stasisActiveTurns === 0) document.getElementById('hud-stasis').textContent = this.stasisCharges;
                skipEnemyMovement = true;
            }

            // Only skip the pathfinding fetches if Stasis is active
            if (!skipEnemyMovement) {
                
                // --- TURN 1: THE ELITE HUNTER (SPEED THROTTLED) ---
                let hunterMovesThisTurn = true;
                if ((this.selectedDifficulty === 'easy' || this.threatProfile.hunter_throttle) && this.playerTurnCount % 2 !== 0) {
                    hunterMovesThisTurn = false; // Easy: 50% Speed
                } else if (this.selectedDifficulty === 'medium' && this.playerTurnCount % 4 === 0) {
                    hunterMovesThisTurn = false; // Medium: 75% Speed (Pauses every 4th step)
                }

                if (hunterMovesThisTurn && this.hunterCoords[0] !== -1) {
                    const hunterPayload = {
                        grid: this.getSharedGrid(),
                        player_coords: this.playerCoords,
                        target_coords: this.hunterCoords,
                        state_data: { enemy_type: 'hunter' }
                    };
                    const hunterRes = await fetch(`${this.apiBaseUrl}/api/v1/enemy/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hunterPayload) });
                    const hunterData = await hunterRes.json();
                    if (hunterData.success && hunterData.result.path.length > 0) this.hunterCoords = hunterData.result.path[0];
                }

                // --- TURN 2: THE VECTOR FIELD SWARM ---
                let swarmMovesThisTurn = true;
                if (this.selectedDifficulty === 'easy' && this.playerTurnCount % 3 === 0) {
                    swarmMovesThisTurn = false; // Easy: 66% Speed
                } else if (this.selectedDifficulty === 'medium' && this.playerTurnCount % 4 === 0) {
                    swarmMovesThisTurn = false; // Medium: 75% Speed
                }

                const activeSwarm = this.swarmCoords.filter(c => c[0] !== -1);
                if (swarmMovesThisTurn && activeSwarm.length > 0) {
                    const swarmPayload = {
                        grid: this.getSharedGrid(), 
                        player_coords: this.playerCoords,
                        target_coords: activeSwarm, 
                        state_data: { enemy_type: 'swarm' }
                    };
                    const swarmRes = await fetch(`${this.apiBaseUrl}/api/v1/enemy/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(swarmPayload) });
                    const swarmData = await swarmRes.json();
                    if (swarmData.success && swarmData.result.next_moves) {
                        let moveIndex = 0;
                        for (let i = 0; i < this.swarmCoords.length; i++) {
                            if (this.swarmCoords[i][0] !== -1) {
                                this.swarmCoords[i] = swarmData.result.next_moves[moveIndex];
                                moveIndex++;
                            }
                        }
                    }
                }

                // --- TURN 3: THE DFS STALKER (STATEFUL) ---
                let stalkerMovesThisTurn = true;
                if (this.selectedDifficulty === 'easy' && this.playerTurnCount % 2 !== 0) {
                    stalkerMovesThisTurn = false; // Easy: 50% Speed
                } else if (this.selectedDifficulty === 'medium' && this.playerTurnCount % 3 === 0) {
                    stalkerMovesThisTurn = false; // Medium: 66% Speed
                }

                if (stalkerMovesThisTurn && this.stalkerCoords[0] !== -1) {
                    if (this.stalkerMemory && this.stalkerMemory.length > 0) {
                        const nextStep = this.stalkerMemory.shift(); 
                        if (this.getSharedGrid()[nextStep[0]][nextStep[1]] !== 1 && 
                            this.getSharedGrid()[nextStep[0]][nextStep[1]] !== 3 && 
                            this.getSharedGrid()[nextStep[0]][nextStep[1]] !== 4) {
                            this.stalkerCoords = nextStep;
                        } else {
                            this.stalkerMemory = []; 
                        }
                    } else {
                        const stalkerPayload = {
                            grid: this.getSharedGrid(),
                            player_coords: this.playerCoords,
                            target_coords: this.stalkerCoords,
                            state_data: { enemy_type: 'stalker' }
                        };
                        const stalkerRes = await fetch(`${this.apiBaseUrl}/api/v1/enemy/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stalkerPayload) });
                        const stalkerData = await stalkerRes.json();
                        if (stalkerData.success && stalkerData.result.path.length > 0) {
                            this.stalkerMemory = stalkerData.result.path; 
                            this.stalkerCoords = this.stalkerMemory.shift(); 
                        }
                    } 
                }

                // --- TURN 4: THE IDDFS SENTINEL (TERRITORIAL TETHER) ---
                if (this.sentinelCoords[0] !== -1) {
                    const distToTerritory = Math.abs(this.playerCoords[0] - this.sentinelOriginalCoords[0]) + 
                                            Math.abs(this.playerCoords[1] - this.sentinelOriginalCoords[1]);
                    let sentinelTarget = this.sentinelOriginalCoords;
                    if (distToTerritory <= 5) sentinelTarget = this.playerCoords; 

                    if (this.sentinelCoords[0] !== sentinelTarget[0] || this.sentinelCoords[1] !== sentinelTarget[1]) {
                        const sentinelPayload = {
                            grid: this.getSharedGrid(),
                            player_coords: sentinelTarget, 
                            target_coords: this.sentinelCoords,
                            state_data: { enemy_type: 'sentinel' }
                        };
                        const sentinelRes = await fetch(`${this.apiBaseUrl}/api/v1/enemy/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sentinelPayload) });
                        const sentinelData = await sentinelRes.json();
                        if (sentinelData.success && sentinelData.result.path.length > 0) {
                            this.sentinelCoords = sentinelData.result.path[0];
                        }
                    }
                }
            } // End of skipEnemyMovement check

            this.renderEntities();

            // --- PHASE 2: ASYMMETRICAL COMBAT LETHALITY ---
            if ((this.hunterCoords[0] === pRow && this.hunterCoords[1] === pCol) ||
                (this.sentinelCoords[0] === pRow && this.sentinelCoords[1] === pCol)) {
                this.showGameEnd('GAME OVER', 'You were executed by an Apex algorithm.');
                return;
            }

            // Check Enemy-Initiated Collisions
            for (let i = 0; i < this.swarmCoords.length; i++) {
                if (this.swarmCoords[i][0] === pRow && this.swarmCoords[i][1] === pCol) {
                    enemyDefeated = true;
                    this.swarmCoords[i] = [-1, -1]; 
                    break; 
                }
            }
            if (this.stalkerCoords[0] === pRow && this.stalkerCoords[1] === pCol) {
                enemyDefeated = true;
                this.stalkerCoords = [-1, -1]; 
            }

            // Consult the Minimax Matrix for Tier 2 collisions
            if (enemyDefeated) {
                const combatPayload = {
                    grid: this.getSharedGrid(),
                    player_coords: [pRow, pCol],
                    target_coords: this.hunterCoords 
                };
                const combatRes = await fetch(`${this.apiBaseUrl}/api/v1/combat/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(combatPayload) });
                const combatData = await combatRes.json();

                if (combatData.success && combatData.result.survivable) {
                    this.currentHP -= 1;

                    this.queuedMove = null;

                    document.getElementById('hud-hp').textContent = `${this.currentHP}/${this.maxHP}`;
                    
                    if (this.currentHP <= 0) {
                        this.showGameEnd('GAME OVER', 'Your vitality is depleted.');
                    } else {
                        this.renderEntities(); 
                    }
                } else {
                    this.showGameEnd('GAME OVER', 'Tactical suicide detected. The Matrix rejected your trade.');
                    return;
                }
            }

        } catch (error) {
            console.error('Network error:', error);
        } finally {
            this.areEnemiesMoving = false;
            if (this.queuedMove && !this.isGameOver) {
                const [nextRowDelta, nextColDelta] = this.queuedMove;
                this.queuedMove = null;
                this.movePlayer(nextRowDelta, nextColDelta);
            }
        }
    }

    bindInputs() {
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter'].includes(key)) e.preventDefault();
            switch (key) {
                case 'w': case 'arrowup': this.movePlayer(-1, 0); break;
                case 's': case 'arrowdown': this.movePlayer(1, 0); break;
                case 'a': case 'arrowleft': this.movePlayer(0, -1); break;
                case 'd': case 'arrowright': this.movePlayer(0, 1); break;
                case 'e': 
                    if (this.stasisCharges > 0 && this.stasisActiveTurns === 0) {
                        this.stasisCharges--;
                        this.stasisActiveTurns = 3;
                        document.getElementById('hud-stasis').textContent = `${this.stasisCharges} (ACTIVE)`;
                        console.log("STASIS DEPLOYED: AI frozen for 3 turns.");
                    }
                    break;
                case 'enter':
                    // Manually re-engage the Gateway if standing on the coordinates
                    if (this.playerCoords[0] === this.goalCoords[0] && this.playerCoords[1] === this.goalCoords[1] && !this.isGameOver) {
                        if (this.currentLevelIndex === this.levelOrder.length - 1) {
                            this.triggerGeneticBoss();
                        } else {
                            this.triggerGatewayLock();
                        }
                    }
                    break;
            }
        });
    }

    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        const tenths = Math.floor((ms % 1000) / 100);
        return `${minutes}:${seconds}.${tenths}`;
    }

    getSharedGrid() {
        const grid = this.terrain.map(row => [...row]);
        
        grid[this.playerCoords[0]][this.playerCoords[1]] = 2; // The Player
        
        // --- PHASE 2: ALIVE CHECKS ---
        if (this.hunterCoords[0] !== -1) grid[this.hunterCoords[0]][this.hunterCoords[1]] = 3;
        this.swarmCoords.forEach(coord => {
            if (coord[0] !== -1) grid[coord[0]][coord[1]] = 4;
        });
        if (this.stalkerCoords[0] !== -1) grid[this.stalkerCoords[0]][this.stalkerCoords[1]] = 5;
        if (this.sentinelCoords[0] !== -1) grid[this.sentinelCoords[0]][this.sentinelCoords[1]] = 6;
        
        return grid;
    }

    // --- PHASE 2: MASTER GATEWAY ROUTER ---
    // ==========================================
    triggerGatewayLock() {
        clearInterval(this.activeTimerInterval);
        this.isGameOver = true; 
        
        // Ensure the retreat button is visible for standard puzzles
        const retreatBtn = document.getElementById('retreat-gateway-btn');
        if (retreatBtn) retreatBtn.classList.remove('hidden');

        // If it is the final level, trigger the Apex Boss
        if (this.currentLevelIndex === this.levelOrder.length - 1) {
            this.triggerGeneticBoss();
            return;
        }

        const puzzleType = this.currentLevelIndex % 2;
        if (puzzleType === 0) this.triggerNQueens(); 
        else this.triggerGraphColoring(); 
    }

    triggerGeneticBoss() {
        const modal = document.getElementById('gateway-modal');
        const gridContainer = document.getElementById('puzzle-grid');
        const runBtn = document.getElementById('run-algo-btn');
        const subtitle = document.getElementById('gateway-subtitle');
        const retreatBtn = document.getElementById('retreat-gateway-btn');

        modal.classList.remove('hidden');
        runBtn.classList.remove('hidden'); 
        document.getElementById('enter-floor-btn').classList.add('hidden');
        
        // STRIP THE RETREAT BUTTON: This is the climax. No turning back.
        if (retreatBtn) retreatBtn.classList.add('hidden'); 
        
        document.getElementById('gateway-tip').innerHTML = `<span style="color: #ef4444; font-weight: bold;">[APEX SECURITY]:</span> The Grimoire is sealed by a mutating cipher. Evolve a decrypt key to escape.`;
        subtitle.textContent = "Target Cipher: GRIMOIRE"; 
        subtitle.style.color = "#facc15";

        // FIX: Removed the restrictive 'height' and 'overflow' constraints. Added Flexbox centering.
        gridContainer.innerHTML = `<div id="genetic-output" style="color: #06b6d4; font-family: monospace; font-size: 1.2rem; text-align: center; margin-top: 20px; min-height: 180px; display: flex; flex-direction: column; justify-content: center;">Initiating DNA Sequence...</div>`;
        
        runBtn.textContent = 'Execute Genetic Evolution';
        runBtn.disabled = false;
        runBtn.onclick = () => this.executeGeneticEvolution();
    }

    async executeGeneticEvolution() {
    const runBtn = document.getElementById('run-algo-btn');
    const output = document.getElementById('genetic-output');
    runBtn.textContent = 'Evolving...'; runBtn.disabled = true;

    try {
        const res = await fetch(`${this.apiBaseUrl}/api/v1/gateway/genetic`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: "GRIMOIRE" })
        });
        const data = await res.json();
        
        if (data.success) {
            let delay = 0;
            let finalScore = 0; // Track the final fitness score

            data.result.evolution.forEach((genData) => {
                setTimeout(() => {
                    output.innerHTML = `Generation: ${genData.gen} <br><br> Best Chromosome: <span style="color: #facc15; letter-spacing: 5px;">${genData.best}</span> <br> Fitness: ${genData.score}/8`;
                    if (genData.score === 8) {
                        output.innerHTML += `<br><br><span style="color: #22c55e;">[CIPHER CRACKED. ABYSS CONQUERED.]</span>`;
                    }
                }, delay);
                delay += 100; // Matrix animation speed
                finalScore = genData.score; // Update to the latest score
            });

            setTimeout(() => {
                if (finalScore === 8) {
                    // Absolute Victory Routing
                    runBtn.classList.add('hidden');
                    const exitBtn = document.getElementById('enter-floor-btn');
                    exitBtn.classList.remove('hidden');
                    exitBtn.textContent = "Claim the Grimoire";
                    
                   exitBtn.onclick = () => { 
                        document.getElementById('gateway-modal').classList.add('hidden');
                        
                        // 1. Calculate and log the final Floor 5 run time
                        this.runMetrics[this.levelOrder[this.currentLevelIndex]] = Date.now() - this.levelStartTime;
                        this.updateAbyssLedger();
                        
                        // 2. Hard Reset Matrix State
                        this.currentLevelIndex = 0;
                        this.maxUnlockedLevelIndex = 0;
                        this.updateLevelDropdown();
                        
                        // 3. THE FIX: Force the Restart button to reload Level 1, not advance to Level 2
                        this.isLevelCleared = false; 
                        
                        // 4. Trigger the Victory / Game Over Modal
                        this.showGameEnd('SYSTEM PURGED', 'The Grimoire is yours. The algorithms have been permanently terminated.');
                    };
                } else {
                    // Local Minimum Trap Routing
                    runBtn.textContent = "Mutation Stalled. Re-roll DNA?";
                    runBtn.disabled = false;
                }
            }, delay + 500);
        }
    } catch (error) { console.error(error); }
}
    // --- ENGINE 1: BACKTRACKING (N-QUEENS) ---
    triggerNQueens() {
        const modal = document.getElementById('gateway-modal');
        const gridContainer = document.getElementById('puzzle-grid');
        const runBtn = document.getElementById('run-algo-btn');
        const subtitle = document.getElementById('gateway-subtitle');

        modal.classList.remove('hidden');
        runBtn.classList.remove('hidden');
        document.getElementById('enter-floor-btn').classList.add('hidden');
        gridContainer.innerHTML = '';
        subtitle.textContent = "Constraint Satisfaction Required";
        subtitle.style.color = "#9ca3af";

        this.failedAttempts = 0;
        runBtn.textContent = 'Auto-Hack (0/10 Fails)';
        runBtn.disabled = true; runBtn.style.color = ''; runBtn.style.borderColor = '';

        // Floor 1 (index 0) = 4 Queens. Floor 3 (index 2) = 5 Queens. Floor 5 (index 4) = 6 Queens.
        this.currentConstraintN = 4 + Math.floor(this.currentLevelIndex / 2); 
        document.getElementById('gateway-tip').innerHTML = `<span style="color: #06b6d4; font-weight: bold;">[OBJECTIVE]:</span> Deploy <span style="color: #facc15;">${this.currentConstraintN}</span> Queens. No two entities may share the same row, column, or diagonal trajectory.`;
        this.userQueens = [];

        // Explicit CSS Reset for N-Queens
        gridContainer.style.display = 'grid';
        gridContainer.style.width = 'fit-content'; 
        gridContainer.style.height = 'auto';
        gridContainer.style.margin = '25px auto';
        gridContainer.style.gap = '2px';
        gridContainer.style.background = '#374151'; 
        gridContainer.style.border = '2px solid #1f2937';
        gridContainer.style.gridTemplateColumns = `repeat(${this.currentConstraintN}, 50px)`;
        gridContainer.style.gridTemplateRows = `repeat(${this.currentConstraintN}, 50px)`;

        for (let r = 0; r < this.currentConstraintN; r++) {
            for (let c = 0; c < this.currentConstraintN; c++) {
                const cell = document.createElement('div');
                cell.classList.add('puzzle-cell', (r + c) % 2 === 0 ? 'light' : 'dark');
                cell.id = `puzzle-cell-${r}-${c}`;
                cell.onclick = () => this.toggleQueen(r, c, cell);
                gridContainer.appendChild(cell);
            }
        }
        runBtn.onclick = () => this.executeBacktracking();
        document.getElementById('enter-floor-btn').onclick = () => this.advanceGateway();
    }

    toggleQueen(r, c, cell) {
        const existingIdx = this.userQueens.findIndex(q => q.r === r && q.c === c);
        if (existingIdx > -1) {
            this.userQueens.splice(existingIdx, 1);
            cell.textContent = ''; cell.style.textShadow = 'none';
        } else {
            if (this.userQueens.some(q => q.r === r) || this.userQueens.some(q => q.c === c)) {
                cell.classList.add('error-shake');
                setTimeout(() => cell.classList.remove('error-shake'), 300);
                return; 
            }
            if (this.userQueens.length < this.currentConstraintN) {
                this.userQueens.push({r, c});
                cell.textContent = '♕'; cell.style.color = '#facc15'; cell.style.textShadow = '0 0 10px rgba(250, 204, 21, 0.8)';
            }
        }
        this.checkManualSolution(); 
    }

    checkManualSolution() {
        if (this.userQueens.length !== this.currentConstraintN) return;
        let isValid = true;
        for (let i = 0; i < this.currentConstraintN; i++) {
            for (let j = i + 1; j < this.currentConstraintN; j++) {
                const q1 = this.userQueens[i], q2 = this.userQueens[j];
                if (q1.r === q2.r || q1.c === q2.c || Math.abs(q1.r - q2.r) === Math.abs(q1.c - q2.c)) isValid = false;
            }
        }
        this.resolveGatewayState(isValid, () => {
            this.userQueens = [];
            document.querySelectorAll('.puzzle-cell').forEach(c => { c.textContent = ''; c.style.textShadow = 'none'; });
        });
    }

    async executeBacktracking() {
        const runBtn = document.getElementById('run-algo-btn');
        runBtn.textContent = 'Calculating...'; runBtn.disabled = true;
        document.querySelectorAll('.puzzle-cell').forEach(c => { c.textContent = ''; c.style.textShadow = 'none'; c.onclick = null; });

        try {
            const res = await fetch(`${this.apiBaseUrl}/api/v1/gateway/backtracking`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ n: this.currentConstraintN })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('gateway-subtitle').textContent = "AI Override Engaged";
                document.getElementById('gateway-subtitle').style.color = "#06b6d4";
                data.result.solution.forEach(([r, c], index) => {
                    setTimeout(() => {
                        const cell = document.getElementById(`puzzle-cell-${r}-${c}`);
                        cell.textContent = '♕'; cell.style.color = '#06b6d4'; cell.style.textShadow = '0 0 15px #06b6d4';
                    }, index * 300); 
                });
                setTimeout(() => {
                    runBtn.classList.add('hidden'); document.getElementById('enter-floor-btn').classList.remove('hidden');
                }, data.result.solution.length * 300 + 400);
            }
        } catch (error) { console.error(error); }
    }

    // --- ENGINE 2: GRAPH COLORING (NETWORK LOCK) ---
    triggerGraphColoring() {
        const modal = document.getElementById('gateway-modal');
        const gridContainer = document.getElementById('puzzle-grid');
        const runBtn = document.getElementById('run-algo-btn');
        const subtitle = document.getElementById('gateway-subtitle');

        modal.classList.remove('hidden'); runBtn.classList.remove('hidden'); document.getElementById('enter-floor-btn').classList.add('hidden');
        subtitle.textContent = "Network Cryptography Encrypted"; subtitle.style.color = "#9ca3af";

        this.failedAttempts = 0;
        runBtn.textContent = 'Auto-Hack (0/10 Fails)'; runBtn.disabled = true; runBtn.style.color = ''; runBtn.style.borderColor = '';

        const graphs = {
            1: { nodes: [[20, 20], [80, 20], [20, 80], [80, 80]], edges: [[0,1], [0,2], [1,3], [2,3], [1,2]], colors: 3 }, // Floor 2
            3: { nodes: [[50, 10], [15, 50], [85, 50], [30, 90], [70, 90]], edges: [[0,1], [0,2], [1,3], [2,4], [3,4], [1,2], [1,4], [2,3]], colors: 4 }, // Floor 4
            5: { nodes: [[50, 15], [20, 40], [80, 40], [20, 80], [80, 80], [50, 60]], edges: [[0,1], [0,2], [1,3], [2,4], [3,5], [4,5], [1,5], [2,5], [1,2]], colors: 4 }
        };
        this.currentGraph = graphs[this.currentLevelIndex] || graphs[1];
        this.nodeColors = new Array(this.currentGraph.nodes.length).fill(-1);

        document.getElementById('gateway-tip').innerHTML = `<span style="color: #06b6d4; font-weight: bold;">[OBJECTIVE]:</span> Color the network nodes. No two connected nodes may share the same color. Colors available: <span style="color: #facc15;">${this.currentGraph.colors}</span>.`;

        gridContainer.style.display = 'block'; gridContainer.style.position = 'relative';
        gridContainer.style.width = '250px'; gridContainer.style.height = '250px';
        gridContainer.style.background = 'transparent'; gridContainer.style.border = 'none';

        let svgHTML = `<svg style="position:absolute; top:0; left:0; width:100%; height:100%; z-index:1;">`;
        this.currentGraph.edges.forEach(edge => {
            const n1 = this.currentGraph.nodes[edge[0]], n2 = this.currentGraph.nodes[edge[1]];
            svgHTML += `<line x1="${n1[0]}%" y1="${n1[1]}%" x2="${n2[0]}%" y2="${n2[1]}%" stroke="#374151" stroke-width="4"/>`;
        });
        svgHTML += `</svg>`;
        gridContainer.innerHTML = svgHTML;

        const colorPalette = ['#1f2937', '#ef4444', '#3b82f6', '#22c55e', '#facc15'];
        this.currentGraph.nodes.forEach((pos, i) => {
            const node = document.createElement('div');
            node.classList.add('graph-node');
            node.style.left = `${pos[0]}%`; node.style.top = `${pos[1]}%`;
            node.textContent = i;
            node.onclick = () => {
                this.nodeColors[i] = (this.nodeColors[i] + 1) % this.currentGraph.colors;
                node.style.background = colorPalette[this.nodeColors[i] + 1];
                node.style.borderColor = '#fff';
                this.checkGraphSolution();
            };
            gridContainer.appendChild(node);
        });

        runBtn.onclick = () => this.executeGraphAutoHack();
        document.getElementById('enter-floor-btn').onclick = () => this.advanceGateway();
    }

    checkGraphSolution() {
        if (this.nodeColors.includes(-1)) return; 
        let isValid = true;
        for (const edge of this.currentGraph.edges) {
            if (this.nodeColors[edge[0]] === this.nodeColors[edge[1]]) { isValid = false; break; }
        }
        this.resolveGatewayState(isValid, () => {
            this.nodeColors.fill(-1);
            document.querySelectorAll('.graph-node').forEach(n => { n.style.background = '#1f2937'; n.style.borderColor = '#374151'; });
        });
    }

    async executeGraphAutoHack() {
        const runBtn = document.getElementById('run-algo-btn');
        runBtn.textContent = 'Calculating...'; runBtn.disabled = true;
        document.querySelectorAll('.graph-node').forEach(n => n.onclick = null);

        try {
            const res = await fetch(`${this.apiBaseUrl}/api/v1/gateway/graph-coloring`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edges: this.currentGraph.edges, num_nodes: this.currentGraph.nodes.length, num_colors: this.currentGraph.colors })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('gateway-subtitle').textContent = "AI Override Engaged";
                document.getElementById('gateway-subtitle').style.color = "#06b6d4";
                const nodes = document.querySelectorAll('.graph-node');
                const colorPalette = ['#ef4444', '#3b82f6', '#22c55e', '#facc15'];

                data.result.solution.forEach((colorIdx, i) => {
                    setTimeout(() => {
                        nodes[i].style.background = colorPalette[colorIdx];
                        nodes[i].style.borderColor = '#fff'; nodes[i].style.boxShadow = `0 0 15px ${colorPalette[colorIdx]}`;
                    }, i * 300);
                });
                setTimeout(() => {
                    runBtn.classList.add('hidden'); document.getElementById('enter-floor-btn').classList.remove('hidden');
                }, data.result.solution.length * 300 + 400);
            }
        } catch (error) { console.error(error); }
    }

    // --- REUSABLE GATEWAY LOGIC ---
    resolveGatewayState(isValid, resetCallback) {
        const subtitle = document.getElementById('gateway-subtitle');
        const runBtn = document.getElementById('run-algo-btn');

        if (isValid) {
            subtitle.textContent = "Manual Override Successful"; subtitle.style.color = "#22c55e";
            runBtn.classList.add('hidden'); document.getElementById('enter-floor-btn').classList.remove('hidden');
            document.querySelectorAll('.puzzle-cell, .graph-node').forEach(c => c.onclick = null);
        } else {
            this.failedAttempts++;
            if (this.failedAttempts >= 10) {
                runBtn.textContent = 'Execute Auto-Hack'; runBtn.disabled = false;
                runBtn.style.color = '#06b6d4'; runBtn.style.borderColor = '#06b6d4';
                subtitle.textContent = "Threshold Met. AI Override Available.";
            } else {
                runBtn.textContent = `Auto-Hack (${this.failedAttempts}/10 Fails)`;
                subtitle.textContent = "Invalid Configuration. Recalibrating."; subtitle.style.color = "#ef4444";
            }
            resetCallback();
        }
    }

    advanceGateway() {
        document.getElementById('gateway-modal').classList.add('hidden');
        this.isLevelCleared = true;
        this.runMetrics[this.levelOrder[this.currentLevelIndex]] = Date.now() - this.levelStartTime;
        this.updateAbyssLedger();
        this.advanceLevel();
    }
    retreatFromGateway() {
        document.getElementById('gateway-modal').classList.add('hidden');
        this.isGameOver = false; // Unfreeze the player
        
        // Resume the global matrix timer
        this.activeTimerInterval = setInterval(() => {
            const elapsed = Date.now() - this.levelStartTime;
            document.getElementById('hud-timer').textContent = this.formatTime(elapsed);
        }, 100);
    }
    
    // --- CORE SYSTEM: GAME OVER HANDLER ---
    showGameEnd(title, message) {
        this.isGameOver = true;
        clearInterval(this.activeTimerInterval);

        const modal = document.getElementById('game-over-modal');
        if (modal) {
            modal.classList.remove('hidden');
            
            // Attempt to update the text based on standard HTML tags
            const titleElement = modal.querySelector('h2');
            const messageElement = modal.querySelector('p');
            
            if (titleElement) titleElement.textContent = title;
            if (messageElement) messageElement.textContent = message;
        } else {
            // Fallback just in case the HTML is missing
            alert(`${title}\n${message}`);
        }
    }

    // --- NEW: Ledger Update Function ---
    updateAbyssLedger() {
        const ledger = document.getElementById('abyss-ledger');
        const list = document.getElementById('ledger-list');
        const totalDisplay = document.getElementById('ledger-total');
        
        ledger.classList.remove('hidden'); // Reveal it once the first floor is beaten
        list.innerHTML = '';
        
        let cumulativeTime = 0;
        for (const [key, timeMs] of Object.entries(this.runMetrics)) {
            cumulativeTime += timeMs;
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.marginBottom = '6px';
            li.innerHTML = `<span>${GRIMOIRE_LEVELS[key].title}</span> <span>${this.formatTime(timeMs)}</span>`;
            list.appendChild(li);
        }
        
        totalDisplay.textContent = this.formatTime(cumulativeTime);
    }
}

const game = new GrimoireEngine();