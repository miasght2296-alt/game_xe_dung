const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Game Config
const ARENA_RADIUS = 1500;
const MAX_SPEED = 28; // Increased speed
const ACCELERATION = 1.2; // Increased acceleration
const FRICTION = 0.95;
const BOUNCE = 1.5; // Increased bounce
const BUMP_MULTIPLIER = 1.8; // Force multiplier for collision
const BASE_RADIUS = 30;
const BASE_MASS = 1;

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function spawnPosition() {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * (ARENA_RADIUS * 0.5);
    return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance
    };
}

// Room State Management
const rooms = {
    'pvp': { players: {}, matchState: 'PLAYING', buffs: [], buffIdCounter: 0 },
    'bot': { players: {}, matchState: 'PLAYING', buffs: [], buffIdCounter: 0 }
};

// Initialize 10 bots in the 'bot' room
for (let i = 0; i < 10; i++) {
    const startPos = spawnPosition();
    rooms['bot'].players[`bot_${i}`] = {
        id: `bot_${i}`,
        name: `Bot ${i + 1}`,
        isBot: true,
        x: startPos.x,
        y: startPos.y,
        vx: 0,
        vy: 0,
        radius: BASE_RADIUS,
        mass: BASE_MASS,
        color: getRandomColor(),
        isDead: false,
        inputs: { up: false, down: false, left: false, right: false },
        score: 0,
        buffs: {} // Active buffs
    };
}

function restartMatch(roomId) {
    const room = rooms[roomId];
    Object.values(room.players).forEach(p => {
        const startPos = spawnPosition();
        p.x = startPos.x;
        p.y = startPos.y;
        p.vx = 0;
        p.vy = 0;
        p.isDead = false;
        p.radius = BASE_RADIUS;
        p.mass = BASE_MASS;
        p.buffs = {};
    });
    room.buffs = []; // clear map buffs
    room.matchState = 'PLAYING';
    io.to(roomId).emit('chat_message', 'Trận đấu mới đã bắt đầu!');
}

function applyBuff(p, type) {
    if (type === 'size') {
        p.radius = BASE_RADIUS * 1.5;
        p.mass = BASE_MASS * 2;
        p.buffs.size = Date.now() + 8000; // 8 seconds
    } else if (type === 'speed') {
        p.buffs.speed = Date.now() + 8000;
    }
}

function spawnBuff(roomId) {
    const room = rooms[roomId];
    if (room.buffs.length < 10) {
        const pos = spawnPosition();
        room.buffs.push({
            id: room.buffIdCounter++,
            type: Math.random() > 0.5 ? 'size' : 'speed', // 'size' or 'speed'
            x: pos.x,
            y: pos.y,
            radius: 20
        });
    }
}

function botAI(p, room) {
    if (p.isDead) return;

    p.inputs = { up: false, down: false, left: false, right: false };

    // 1. Safety first
    const distFromCenter = Math.hypot(p.x, p.y);
    if (distFromCenter > ARENA_RADIUS * 0.8) {
        if (p.x > 50) p.inputs.left = true;
        if (p.x < -50) p.inputs.right = true;
        if (p.y > 50) p.inputs.up = true;
        if (p.y < -50) p.inputs.down = true;
        return;
    }

    // 2. Target nearest (players > buffs > bots)
    let target = null;
    let minDist = Infinity;

    // Look for buffs
    room.buffs.forEach(b => {
        let d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < minDist) {
            minDist = d;
            target = { x: b.x, y: b.y };
        }
    });

    // Look for enemies
    Object.values(room.players).filter(other => !other.isDead && other.id !== p.id).forEach(other => {
        let d = Math.hypot(p.x - other.x, p.y - other.y);
        if (other.isBot) d += 400; // Highly prefer real players over bots
        if (d < minDist) {
            minDist = d;
            target = { x: other.x, y: other.y };
        }
    });

    if (target) {
        if (p.x > target.x + 20) p.inputs.left = true;
        if (p.x < target.x - 20) p.inputs.right = true;
        if (p.y > target.y + 20) p.inputs.up = true;
        if (p.y < target.y - 20) p.inputs.down = true;
    }
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('join_game', (data) => {
        const { name, room } = data;
        if (!rooms[room]) return;

        currentRoom = room;
        socket.join(room);

        const startPos = spawnPosition();
        rooms[room].players[socket.id] = {
            id: socket.id,
            name: name.substring(0, 15) || 'Khách',
            isBot: false,
            x: startPos.x,
            y: startPos.y,
            vx: 0,
            vy: 0,
            radius: BASE_RADIUS,
            mass: BASE_MASS,
            color: getRandomColor(),
            isDead: false,
            inputs: { up: false, down: false, left: false, right: false },
            score: 0,
            buffs: {}
        };

        socket.emit('init', { id: socket.id, arenaRadius: ARENA_RADIUS });
    });

    socket.on('input', (inputs) => {
        if (currentRoom && rooms[currentRoom].players[socket.id] && !rooms[currentRoom].players[socket.id].isDead) {
            rooms[currentRoom].players[socket.id].inputs = inputs;
        }
    });

    socket.on('respawn', () => {
        if (currentRoom && rooms[currentRoom].players[socket.id] && rooms[currentRoom].players[socket.id].isDead) {
            const p = rooms[currentRoom].players[socket.id];
            const startPos = spawnPosition();
            p.x = startPos.x;
            p.y = startPos.y;
            p.vx = 0;
            p.vy = 0;
            p.isDead = false;
            p.score = Math.floor(p.score / 2); // lose half score on respawn
            p.radius = BASE_RADIUS;
            p.mass = BASE_MASS;
            p.buffs = {};
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom].players[socket.id]) {
            delete rooms[currentRoom].players[socket.id];
        }
    });
});

let frameCount = 0;
// Physics Engine Loop (60 FPS)
function updatePhysics() {
    frameCount++;

    for (let roomId in rooms) {
        const room = rooms[roomId];
        const playerKeys = Object.keys(room.players);
        const alivePlayers = playerKeys.map(k => room.players[k]).filter(p => !p.isDead);

        // Spawn buffs randomly
        if (frameCount % 180 === 0 && Math.random() < 0.5) spawnBuff(roomId);

        // Bot AI
        alivePlayers.forEach(p => {
            if (p.isBot) botAI(p, room);
        });

        // Match Logic
        if (room.matchState === 'PLAYING') {
            const hasRealPlayers = playerKeys.some(k => !room.players[k].isBot);
            if (hasRealPlayers || roomId === 'bot') { // Bot room can end even with 0 real players to cycle round
                if (alivePlayers.length <= 1 && playerKeys.length > 1) {
                    room.matchState = 'ENDED';
                    const winnerName = alivePlayers.length === 1 ? alivePlayers[0].name : "Không ai";
                    io.to(roomId).emit('chat_message', `Trận kết thúc! ${winnerName} WIN. Trận mới sẽ bắt đầu sau 5 giây...`);
                    setTimeout(() => restartMatch(roomId), 5000);
                }
            }
        }

        // Update positions, velocity, & buffs
        alivePlayers.forEach(p => {
            const now = Date.now();
            // Handle buff expiration
            if (p.buffs.size && now > p.buffs.size) {
                p.radius = BASE_RADIUS;
                p.mass = BASE_MASS;
                delete p.buffs.size;
            }
            if (p.buffs.speed && now > p.buffs.speed) {
                delete p.buffs.speed;
            }

            const currentAccel = p.buffs.speed ? ACCELERATION * 1.5 : ACCELERATION;
            const currentMaxSpeed = p.buffs.speed ? MAX_SPEED * 1.5 : MAX_SPEED;

            if (p.inputs.up) p.vy -= currentAccel;
            if (p.inputs.down) p.vy += currentAccel;
            if (p.inputs.left) p.vx -= currentAccel;
            if (p.inputs.right) p.vx += currentAccel;

            p.vx *= FRICTION;
            p.vy *= FRICTION;

            const speed = Math.hypot(p.vx, p.vy);
            if (speed > currentMaxSpeed) {
                p.vx = (p.vx / speed) * currentMaxSpeed;
                p.vy = (p.vy / speed) * currentMaxSpeed;
            }

            p.x += p.vx;
            p.y += p.vy;

            // Pick up buffs
            for (let i = room.buffs.length - 1; i >= 0; i--) {
                const b = room.buffs[i];
                if (Math.hypot(p.x - b.x, p.y - b.y) < p.radius + b.radius) {
                    applyBuff(p, b.type);
                    room.buffs.splice(i, 1);
                }
            }
        });

        // Handle Collisions between cars
        for (let i = 0; i < alivePlayers.length; i++) {
            for (let j = i + 1; j < alivePlayers.length; j++) {
                const p1 = alivePlayers[i];
                const p2 = alivePlayers[j];

                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const distance = Math.hypot(dx, dy);
                const minDist = p1.radius + p2.radius;

                if (distance < minDist) {
                    const nx = dx / distance;
                    const ny = dy / distance;

                    const dvx = p1.vx - p2.vx;
                    const dvy = p1.vy - p2.vy;
                    const velocityAlongNormal = dvx * nx + dvy * ny;

                    if (velocityAlongNormal > 0) continue;

                    const j_impulse = -(1 + BOUNCE) * velocityAlongNormal * BUMP_MULTIPLIER;
                    const j_per_mass = j_impulse / (1/p1.mass + 1/p2.mass);

                    p1.vx += (j_per_mass / p1.mass) * nx;
                    p1.vy += (j_per_mass / p1.mass) * ny;
                    p2.vx -= (j_per_mass / p2.mass) * nx;
                    p2.vy -= (j_per_mass / p2.mass) * ny;

                    const overlap = minDist - distance;
                    const correction = overlap / (1/p1.mass + 1/p2.mass);
                    const percent = 0.8; 
                    
                    p1.x += nx * (correction / p1.mass) * percent;
                    p1.y += ny * (correction / p1.mass) * percent;
                    p2.x -= nx * (correction / p2.mass) * percent;
                    p2.y -= ny * (correction / p2.mass) * percent;

                    io.to(roomId).emit('collision_event', { 
                        x: p2.x + nx * p2.radius, 
                        y: p2.y + ny * p2.radius,
                        intensity: Math.abs(j_impulse)
                    });
                    
                    if (Math.abs(j_impulse) > 10) {
                        p1.score += 5;
                        p2.score += 5;
                    }
                }
            }
        }

        // Check bounds
        alivePlayers.forEach(p => {
            const distFromCenter = Math.hypot(p.x, p.y);
            if (distFromCenter > ARENA_RADIUS) {
                p.isDead = true;
                io.to(roomId).emit('player_died', p.name);
                
                // Award points to last hit? A bit complex for now. Just deduct from self.
                p.score = Math.max(0, p.score - 20);
            }
        });

        // Broadcast state
        io.to(roomId).emit('state', {
            players: Object.values(room.players).map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                radius: p.radius,
                color: p.color,
                isDead: p.isDead,
                score: p.score,
                buffs: Object.keys(p.buffs)
            })),
            buffs: room.buffs
        });
    }
}

setInterval(updatePhysics, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Bumper Cars Server listening on port ${PORT}`);
});
