import { GameEngine } from './engine';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  const engine = new GameEngine(app);
  engine.start();
}
