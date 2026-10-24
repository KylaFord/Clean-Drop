const ROUND_SECONDS = 45;
const START_HEARTS = 3;
const WIN_TARGET = 24;
const POLLUTED_CHANCE = 0.3;
const BUCKET_KEY_SPEED = 520; // px per second

const $ = (id) => document.getElementById(id);
const screens = { welcome: $("screen-welcome"), playing: $("screen-game"), results: $("screen-results") };
const playArea = $("play-area");
const bucket = $("bucket");
const hearts = Array.from(document.querySelectorAll(".heart"));

let state = "welcome";
let rafId = 0;
let drops = [];
let timeouts = [];
let keys = { left: false, right: false };
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
  g = { hearts: START_HEARTS, clean: 0, startTime: 0, last: 0, spawnTimer: 0, bucketX: 0, dragging: false, elapsed: 0 };
  $("score").textContent = "0";
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

// Returns true when the round ended.
function catchDrop(d) {
  if (d.polluted) {
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
  const score = $("score");
  score.textContent = g.clean;
  score.classList.add("bump");
  later(() => score.classList.remove("bump"), 400);
  const splash = document.createElement("div");
  splash.className = "splash";
  splash.style.left = g.bucketX + "px";
  splash.style.bottom = bucket.offsetHeight + 6 + "px";
  playArea.appendChild(splash);
  later(() => splash.remove(), 450);
  if (g.clean >= WIN_TARGET) {
    endRound(true);
    return true;
  }
  return false;
}

function endRound(won) {
  if (state !== "playing") return;
  const { clean, elapsed } = g;
  cleanup();
  $("result-title").textContent = won ? "Nice catch!" : "Game Over";
  $("final-score").textContent = clean;
  $("final-clean").textContent = clean;
  $("final-time").textContent = elapsed.toFixed(1) + "s";
  showScreen("results");
  $("again-btn").focus();
}

function goHome() {
  cleanup();
  showScreen("welcome");
  $("start-btn").focus();
}

$("start-btn").addEventListener("click", startRound);
$("again-btn").addEventListener("click", startRound);
$("home-btn").addEventListener("click", goHome);
