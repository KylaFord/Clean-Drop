const ROUND_SECONDS = 45;
const START_HEARTS = 3;
const WIN_TARGETS = { easy: 16, normal: 24, hard: 32 };
const DIFFICULTY_NAMES = { easy: "Easy", normal: "Normal", hard: "Hard" };
const MILESTONES = [
  { score: 5, message: "Great start! Keep it up!" },
  { score: 10, message: "You're on a roll!" },
  { score: 15, message: "Super catcher!" },
  { score: 20, message: "Amazing work!" },
  { score: 25, message: "Clean-water hero!" },
  { score: 30, message: "Incredible catching!" }
];
const POLLUTED_CHANCE = 0.3;
const BUCKET_KEY_SPEED = 520; // px per second

const $ = (id) => document.getElementById(id);
const screens = { welcome: $("screen-welcome"), playing: $("screen-game"), results: $("screen-results") };
const playArea = $("play-area");
const bucket = $("bucket");
const hearts = Array.from(document.querySelectorAll(".heart"));
const SOUND_CUES = {
  button: { type: "sine", volume: 0.025, notes: [[660, 0.045, 0]] },
  clean: { type: "sine", volume: 0.045, notes: [[587, 0.09, 0], [784, 0.11, 0.065], [988, 0.16, 0.13]] },
  toxic: { type: "triangle", volume: 0.045, notes: [[196, 0.09, 0], [147, 0.12, 0.07]] },
  win: { type: "sine", volume: 0.06, notes: [[523, 0.18, 0.16], [659, 0.18, 0.25], [784, 0.18, 0.34], [1047, 0.3, 0.43]] },
  lose: { type: "triangle", volume: 0.05, notes: [[330, 0.16, 0.16], [247, 0.18, 0.29], [196, 0.25, 0.43]] }
};

let state = "welcome";
let rafId = 0;
let drops = [];
let timeouts = [];
let keys = { left: false, right: false };
let audioContext;
let g; // per-round data

function showScreen(name) {
  state = name;
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function later(fn, ms) {
  const id = setTimeout(() => {
    timeouts = timeouts.filter((t) => t !== id);
    fn();
  }, ms);
  timeouts.push(id);
}

function getAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;

  try {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  } catch {
    return null;
  }
}

function playSound(name) {
  const cue = SOUND_CUES[name];
  const context = getAudioContext();
  if (!cue || !context) return;

  try {
    const now = context.currentTime;

    cue.notes.forEach(([frequency, duration, offset]) => {
      const start = now + offset;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue.type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(cue.volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    });
  } catch {
    return;
  }
}

function areaSize() {
  return { w: playArea.clientWidth, h: playArea.clientHeight };
}

function setBucketX(x) {
  const { w } = areaSize();
  const half = bucket.offsetWidth / 2;
  g.bucketX = Math.max(half, Math.min(w - half, x));
  bucket.style.left = g.bucketX - half + "px";
}

function startRound() {
  cleanup();
  showScreen("playing");
  const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
  g = { hearts: START_HEARTS, clean: 0, target: WIN_TARGETS[difficulty], difficulty, startTime: 0, last: 0, spawnTimer: 0, bucketX: 0, dragging: false, elapsed: 0 };
  $("score").textContent = `0 / ${g.target}`;
  $("milestone").textContent = "";
  $("milestone").classList.remove("visible");
  $("time").textContent = ROUND_SECONDS;
  $("score").classList.remove("bump");
  playArea.classList.remove("hit");
  renderHearts();
  bucket.style.width = Math.max(64, Math.min(96, areaSize().w * 0.24)) + "px";
  setBucketX(areaSize().w / 2);

  playArea.addEventListener("pointerdown", onPointerDown);
  playArea.addEventListener("pointermove", onPointerMove);
  playArea.addEventListener("pointerup", onPointerEnd);
  playArea.addEventListener("pointercancel", onPointerEnd);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onResize);

  rafId = requestAnimationFrame(frame);
}

function cleanup() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  timeouts.forEach(clearTimeout);
  timeouts = [];
  playArea.removeEventListener("pointerdown", onPointerDown);
  playArea.removeEventListener("pointermove", onPointerMove);
  playArea.removeEventListener("pointerup", onPointerEnd);
  playArea.removeEventListener("pointercancel", onPointerEnd);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("resize", onResize);
  keys = { left: false, right: false };
  drops.forEach((d) => d.el.remove());
  drops = [];
  playArea.querySelectorAll(".splash").forEach((s) => s.remove());
  playArea.querySelectorAll(".bucket-burst").forEach((s) => s.remove());
  bucket.querySelectorAll(".bucket-splash").forEach((s) => s.remove());
  document.querySelectorAll(".fx").forEach((f) => f.remove());
  screens.results.classList.remove("win", "lose");
}

function dramaticEnd(won) {
  screens.results.classList.add(won ? "win" : "lose");
  const fx = document.createElement("div");
  fx.className = "fx " + (won ? "win" : "lose");
  fx.setAttribute("aria-hidden", "true");
  if (won) {
    const colors = ["#ffd91a", "#4169e1", "#e8141c", "#3aa0ff", "#fff"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("span");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.setProperty("--dx", Math.random() * 160 - 80 + "px");
      c.style.animationDelay = Math.random() * 0.6 + "s";
      c.style.animationDuration = 2 + Math.random() * 1.5 + "s";
      fx.appendChild(c);
    }
  }
  document.body.appendChild(fx);
}

function onPointerDown(e) {
  if (state !== "playing") return;
  g.dragging = true;
  playArea.setPointerCapture(e.pointerId);
  moveToPointer(e);
}
function onPointerMove(e) {
  if (state === "playing" && g.dragging) moveToPointer(e);
}
function onPointerEnd() {
  if (g) g.dragging = false;
}
function moveToPointer(e) {
  setBucketX(e.clientX - playArea.getBoundingClientRect().left);
}
function onResize() {
  if (state === "playing") setBucketX(g.bucketX);
}

function onKeyDown(e) {
  if (state !== "playing") return;
  if (e.key === "ArrowLeft") keys.left = true;
  else if (e.key === "ArrowRight") keys.right = true;
  else return;
  e.preventDefault();
}
function onKeyUp(e) {
  if (e.key === "ArrowLeft") keys.left = false;
  else if (e.key === "ArrowRight") keys.right = false;
}

function renderHearts() {
  hearts.forEach((h, i) => h.classList.toggle("lost", i >= g.hearts));
  $("hearts").setAttribute("aria-label", g.hearts + (g.hearts === 1 ? " heart left" : " hearts left"));
}

function showMilestone() {
  const milestone = MILESTONES.find((item) => item.score === g.clean);
  if (!milestone) return;

  const message = $("milestone");
  message.textContent = milestone.message;
  message.classList.add("visible");
  later(() => {
    message.classList.remove("visible");
    message.textContent = "";
  }, 1500);
}

function spawnDrop(elapsed) {
  const { w } = areaSize();
  const size = 30 + Math.random() * 12;
  const polluted = Math.random() < POLLUTED_CHANCE;
  const safeGap = bucket.offsetWidth / 2 + size;
  const pick = () => size / 2 + Math.random() * (w - size);
  let x = pick();
  // Avoid spawning right above the bucket.
  for (let i = 0; i < 6 && Math.abs(x - g.bucketX) < safeGap; i++) x = pick();
  const el = document.createElement("div");
  el.className = "drop " + (polluted ? "polluted" : "clean");
  el.style.width = el.style.height = size + "px";
  el.innerHTML = '<span class="shape"></span>';
  playArea.appendChild(el);
  const speed = 130 + Math.random() * 60 + Math.min(elapsed, ROUND_SECONDS) * 2.5; // px per second
  drops.push({ el, x, y: -size, size, speed, polluted });
}

function frame(now) {
  if (state !== "playing") return;
  if (!g.startTime) g.startTime = g.last = now;
  const dt = Math.min((now - g.last) / 1000, 0.1);
  g.last = now;
  const elapsed = (now - g.startTime) / 1000;
  g.elapsed = Math.min(elapsed, ROUND_SECONDS);
  const remaining = Math.max(0, ROUND_SECONDS - elapsed);
  $("time").textContent = Math.ceil(remaining);

  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (dir) setBucketX(g.bucketX + dir * BUCKET_KEY_SPEED * dt);

  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) {
    spawnDrop(elapsed);
    g.spawnTimer = Math.max(0.55, 1.0 - elapsed * 0.01) * (0.8 + Math.random() * 0.4);
  }

  const { h } = areaSize();
  const half = bucket.offsetWidth / 2;
  const openingY = h - 6 - bucket.offsetHeight;
  for (const d of [...drops]) {
    d.y += d.speed * dt;
    d.el.style.transform = `translate(${d.x - d.size / 2}px, ${d.y}px)`;
    const bottom = d.y + d.size;
    if (bottom >= openingY && d.y < openingY + bucket.offsetHeight * 0.6 && Math.abs(d.x - g.bucketX) <= half) {
      removeDrop(d);
      if (catchDrop(d)) return;
    } else if (d.y > h) {
      removeDrop(d);
    }
  }

  if (remaining <= 0) {
    endRound(false);
    return;
  }
  rafId = requestAnimationFrame(frame);
}

function removeDrop(d) {
  d.el.remove();
  drops = drops.filter((x) => x !== d);
}

function showCatchReaction(type) {
  const bucketSplash = document.createElement("span");
  bucketSplash.className = `bucket-splash ${type}`;
  bucket.appendChild(bucketSplash);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    later(() => bucketSplash.remove(), 220);
    return;
  }

  const splash = document.createElement("div");
  splash.className = `splash ${type}`;
  splash.setAttribute("aria-hidden", "true");
  splash.style.left = g.bucketX + "px";
  splash.style.bottom = bucket.offsetHeight + 6 + "px";
  playArea.appendChild(splash);
  const burst = document.createElement("div");
  burst.className = `bucket-burst ${type}`;
  burst.setAttribute("aria-hidden", "true");
  burst.style.left = g.bucketX + "px";
  burst.style.bottom = bucket.offsetHeight + 6 + "px";
  const droplets = [
    [-26, -18, -50], [-18, -29, -30], [-9, -38, -15],
    [0, -42, 0], [10, -37, 15], [20, -29, 30], [27, -17, 50]
  ];
  droplets.forEach(([x, y, rotation], index) => {
    const droplet = document.createElement("span");
    droplet.style.setProperty("--dx", x + "px");
    droplet.style.setProperty("--dy", y + "px");
    droplet.style.setProperty("--turn", rotation + "deg");
    droplet.style.setProperty("--delay", index * 25 + "ms");
    burst.appendChild(droplet);
  });
  playArea.appendChild(burst);
  later(() => {
    splash.remove();
    bucketSplash.remove();
    burst.remove();
  }, 450);
}

// Returns true when the round ended.
function catchDrop(d) {
  if (d.polluted) {
    playSound("toxic");
    showCatchReaction("polluted");
    g.hearts--;
    renderHearts();
    playArea.classList.remove("hit");
    void playArea.offsetWidth;
    playArea.classList.add("hit");
    later(() => playArea.classList.remove("hit"), 400);
    if (g.hearts <= 0) {
      endRound(false);
      return true;
    }
    return false;
  }
  g.clean++;
  playSound("clean");
  const score = $("score");
  score.textContent = `${g.clean} / ${g.target}`;
  showMilestone();
  score.classList.add("bump");
  later(() => score.classList.remove("bump"), 400);
  showCatchReaction("clean");
  if (g.clean >= g.target) {
    endRound(true);
    return true;
  }
  return false;
}

function endRound(won) {
  if (state !== "playing") return;
  playSound(won ? "win" : "lose");
  const { clean, elapsed, difficulty } = g;
  cleanup();
  $("result-title").textContent = won ? "Nice catch!" : "Game Over";
  $("final-score").textContent = clean;
  $("final-clean").textContent = clean;
  $("final-time").textContent = elapsed.toFixed(1) + "s";
  $("final-difficulty").textContent = DIFFICULTY_NAMES[difficulty];
  showScreen("results");
  dramaticEnd(won);
  $("again-btn").focus();
}

function goHome() {
  cleanup();
  showScreen("welcome");
  $("start-btn").focus();
}

$("start-btn").addEventListener("click", startRound);
$("again-btn").addEventListener("click", startRound);
$("reset-btn").addEventListener("click", startRound);
$("home-btn").addEventListener("click", goHome);
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("button")) playSound("button");
});
