const socket = io();

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myId = null;
let arenaRadius = 1000;
let players = [];
let buffs = [];
let particles = [];
let stars = [];

// Input state
const keys = { up: false, down: false, left: false, right: false };

// --- Audio System ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null; // initialized on first interaction
let sfxVolume = 0.5;
let bgmVolume = 0.5;

// We use a public royalty-free track for BGM
let bgmAudio = new Audio('https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=electronic-rock-king-around-here-15045.mp3');
bgmAudio.loop = true;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        bgmAudio.volume = bgmVolume;
        bgmAudio.play().catch(() => console.log("BGM blocked by browser"));
    }
}

function playSFX(intensity) {
    if (!audioCtx || sfxVolume <= 0) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    // Deeper sound for harder hit
    const startFreq = intensity > 20 ? 100 : 200;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(Math.min(1, intensity / 30) * sfxVolume, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

function updateVolume() {
    bgmVolume = parseFloat(document.getElementById('bgm-volume').value);
    sfxVolume = parseFloat(document.getElementById('sfx-volume').value);
    bgmAudio.volume = bgmVolume;
}

// --- UI Actions ---
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
}

function quitGame() {
    socket.emit('disconnect_manual'); // custom event to leave
    window.location.reload(); // simple way to reset client
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Init stars background
for(let i=0; i<200; i++) {
    stars.push({
        x: (Math.random() - 0.5) * 4000,
        y: (Math.random() - 0.5) * 4000,
        size: Math.random() * 2 + 1,
        alpha: Math.random()
    });
}

function joinGame() {
    initAudio(); // Initialize audio on first click
    const name = document.getElementById('player-name').value || 'Guest';
    const room = document.getElementById('game-mode').value;
    socket.emit('join_game', { name, room });
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    document.getElementById('settings-btn').classList.remove('hidden');
}

function respawn() {
    socket.emit('respawn');
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
}

// --- Socket events ---
socket.on('init', (data) => {
    myId = data.id;
    arenaRadius = data.arenaRadius;
});

socket.on('state', (data) => {
    players = data.players;
    buffs = data.buffs;
    updateLeaderboard();

    // Auto hide death screen if revived
    const me = players.find(p => p.id === myId);
    if (me && !me.isDead) {
        document.getElementById('death-screen').classList.add('hidden');
        if (document.getElementById('login-screen').classList.contains('hidden')) {
            document.getElementById('game-ui').classList.remove('hidden');
        }
    }
});

socket.on('collision_event', (data) => {
    // Generate sparks
    const numSparks = Math.min(30, Math.floor(data.intensity * 3));
    for (let i = 0; i < numSparks; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 3;
        particles.push({
            x: data.x,
            y: data.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color: '#ffa502'
        });
    }
    
    // Play SFX
    playSFX(data.intensity);
});

socket.on('player_died', (name) => {
    showKillMsg(`${name} đã văng khỏi mây!`);
    
    // Check if it's me
    const me = players.find(p => p.id === myId);
    if (me && me.isDead) {
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('death-screen').classList.remove('hidden');
    }
});

socket.on('chat_message', (msg) => {
    showKillMsg(msg);
});

function showKillMsg(msg) {
    const feed = document.getElementById('kill-feed');
    const el = document.createElement('div');
    el.className = 'kill-msg';
    el.innerText = msg;
    feed.appendChild(el);
    setTimeout(() => {
        if(feed.contains(el)) feed.removeChild(el);
    }, 3500);
}

function updateLeaderboard() {
    const sorted = [...players].sort((a,b) => b.score - a.score).slice(0, 5);
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    sorted.forEach(p => {
        if(p.isDead) return;
        const li = document.createElement('li');
        li.innerHTML = `<span style="color:${p.color}">${p.name}</span> <span>${Math.floor(p.score)}</span>`;
        list.appendChild(li);
    });
}

// --- Input handling ---
window.addEventListener('keydown', (e) => {
    if(e.key === 'Tab') {
        e.preventDefault();
        document.getElementById('leaderboard').classList.toggle('hidden');
        return;
    }

    if(e.key === 'w' || e.key === 'ArrowUp') keys.up = true;
    if(e.key === 's' || e.key === 'ArrowDown') keys.down = true;
    if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = true;
    if(e.key === 'd' || e.key === 'ArrowRight') keys.right = true;
    socket.emit('input', keys);
});

window.addEventListener('keyup', (e) => {
    if(e.key === 'w' || e.key === 'ArrowUp') keys.up = false;
    if(e.key === 's' || e.key === 'ArrowDown') keys.down = false;
    if(e.key === 'a' || e.key === 'ArrowLeft') keys.left = false;
    if(e.key === 'd' || e.key === 'ArrowRight') keys.right = false;
    socket.emit('input', keys);
});

// --- Render Loop ---
function render() {
    requestAnimationFrame(render);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find my player to center camera
    let me = players.find(p => p.id === myId);
    let camX = 0;
    let camY = 0;
    
    if (me && !me.isDead) {
        camX = me.x - canvas.width / 2;
        camY = me.y - canvas.height / 2;
    } else if (players.length > 0) {
        const spec = players.find(p => !p.isDead);
        if(spec) {
            camX = spec.x - canvas.width / 2;
            camY = spec.y - canvas.height / 2;
        }
    }

    ctx.save();
    ctx.translate(-camX, -camY);

    // Draw Stars (Parallax)
    ctx.fillStyle = 'white';
    stars.forEach(s => {
        ctx.globalAlpha = s.alpha;
        ctx.beginPath();
        ctx.arc(s.x + camX*0.8, s.y + camY*0.8, s.size, 0, Math.PI*2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw Arena
    ctx.beginPath();
    ctx.arc(0, 0, arenaRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#1e272e';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#0fbcf9';
    ctx.stroke();

    // Draw Grid on Arena
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    ctx.save();
    ctx.clip(); 
    for(let i = -arenaRadius; i < arenaRadius; i+=100) {
        ctx.beginPath();
        ctx.moveTo(i, -arenaRadius);
        ctx.lineTo(i, arenaRadius);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-arenaRadius, i);
        ctx.lineTo(arenaRadius, i);
        ctx.stroke();
    }
    ctx.restore();

    // Draw Buffs
    buffs.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        if (b.type === 'size') {
            ctx.fillStyle = '#ff3838'; // Red for size
            ctx.shadowColor = '#ff3838';
        } else {
            ctx.fillStyle = '#32ff7e'; // Green for speed
            ctx.shadowColor = '#32ff7e';
        }
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Montserrat';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.type === 'size' ? 'M' : 'S', b.x, b.y);
    });

    // Draw Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw Players
    players.forEach(p => {
        if (p.isDead) return;

        // Glow effect
        ctx.shadowBlur = p.buffs.includes('size') ? 40 : 20;
        ctx.shadowColor = p.color;
        
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner circle
        ctx.shadowBlur = 0;
        ctx.fillStyle = p.buffs.includes('speed') ? '#fff200' : '#2d3436';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
        
        // Name tag
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px Montserrat';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.x, p.y - p.radius - 10);
    });

    ctx.restore();
}

render();
