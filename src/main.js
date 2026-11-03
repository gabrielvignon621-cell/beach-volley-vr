import './style.css';
import { initPhysics } from './physics/PhysicsWorld.js';
import { Game } from './core/Game.js';
import { Menu } from './ui/Menu.js';

async function boot() {
  const menu = new Menu();
  menu.progress(0.08, 'Carregando a física…');
  await initPhysics();

  const game = new Game(document.querySelector('#stage'), (value, label) => menu.progress(value, label));
  await game.build();
  game.start();
  await menu.connect(game);

  // Acesso pelo console para depuração: window.game
  if (import.meta.env.DEV) window.game = game;
}

boot().catch((error) => {
  console.error(error);
  const status = document.querySelector('#status');
  status.dataset.state = 'error';
  status.querySelector('.status-text').textContent = `Falha ao preparar a quadra: ${error.message}`;
});
