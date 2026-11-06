# Beach Volley VR

Vôlei de praia 2x2 em WebXR para o Meta Quest Browser: você e a Duda contra Rafa e Léo, jogado com as próprias mãos (hand tracking) ou com os controles Touch, direto no navegador. Todas as cinco fases estão implementadas.

**Jogar agora:** https://gabrielvignon621-cell.github.io/beach-volley-vr/ (no Quest, abra no Meta Quest Browser e toque em **Entrar em VR**). O site é publicado automaticamente a cada push na `main`.

## Rodar

Requisitos: Node.js 20.19+ (ou 22.12+).

```powershell
cd "$HOME\Desktop\BeachVolleyVR"
npm.cmd install
npm.cmd run dev
```

O servidor sobe em **HTTPS** (certificado autoassinado), na porta 5173, e mostra os endereços `Local` e `Network`.

- **PC:** abra `https://localhost:5173` e aceite o aviso de certificado (Avançado → Continuar). Use **Treinar no PC** ou **Assistir partida**.
- **Quest (mesma rede Wi-Fi):** no Meta Quest Browser, abra o endereço `Network` (ex.: `https://192.168.0.100:5173`), aceite o aviso de certificado e toque em **Entrar em VR**. Se o Firewall do Windows perguntar, permita o Node.js em redes privadas.
- **Quest via ngrok (qualquer rede):** rode o servidor sem SSL e abra a URL do túnel.

  ```powershell
  $env:NO_SSL = '1'; npm.cmd run dev
  ngrok http 5173
  ```

Build de produção: `npm.cmd run build` (saída em `dist/`) e `npm.cmd run preview` para servir.

## Como jogar em VR

Ao entrar, o menu aparece na sua frente. Escolha a dificuldade (Fácil, Normal, Difícil) e o formato (1 set até 21 ou melhor de 3), e toque em **Jogar partida**.

| Golpe | Como fazer |
|-------|------------|
| **Manchete** | Junte os antebraços, paralelos e esticados, e deixe a bola bater neles. A bola sobe para a Duda levantar. |
| **Toque (levantamento)** | Mãos juntas acima da testa, palmas para cima. A bola vai para o ataque da Duda. |
| **Cortada** | Mão aberta e swing rápido (acima de ~3 m/s). Força e direção vêm da sua mão. |
| **Toque livre** | Qualquer outro contato rebate com a física da mão. |
| **Saque** | Quando for sua vez, a bola flutua na sua frente. Faça pinça (ou aperte o gatilho) para lançar e bata nela. Também dá para bater direto. |

| Comando | Mãos | Controles |
|---------|------|-----------|
| Menu / pausa | Encoste o indicador direito no botão do relógio do pulso esquerdo | Grip (apertar a lateral) |
| Botões do menu | Encostar o dedo, ou apontar e fazer pinça | Apontar e gatilho |
| Girar 45° | — | Analógico direito para os lados |
| Teletransporte | Aponte o indicador (outros dedos dobrados) para o chão do seu lado, espere o arco e abra a mão | Analógico direito para frente, mirar o arco e soltar (só no seu lado da quadra) |
| Recentrar | Botão no menu (também ajusta sua altura à dos bots) | Botão no menu |

O jogo é room-scale: você anda de verdade para alcançar a bola. Ao entrar, você é posicionado automaticamente na recepção, de frente para a rede, com os olhos na altura dos bots. Locomoção artificial é opcional e sempre com fade, para conforto.

## No PC

| Tecla | Treino | Assistir partida |
|-------|--------|------------------|
| Espaço | Máquina saca | — |
| S / R | Seu saque / recolocar bola | — |
| N / T | — | Nova partida / ir treinar |
| 1 · 2 · 3 · 4 | Câmera Jogador · TV · Rede · Bola (transmissão) | igual |
| Esc | Volta ao menu | igual |

**Assistir partida** roda uma partida completa com 4 bots (a Bia entra no seu lugar), com placar, replay e reinício automático.

## Regras implementadas

- Rally point: set até 21 (tie-break até 15 no melhor de 3), sempre com 2 pontos de vantagem.
- Até 3 toques por lado; o bloqueio conta como toque e o bloqueador pode tocar de novo.
- O mesmo jogador não toca duas vezes seguidas. Contatos do mesmo jogador em menos de 0,35 s (duas mãos, antebraços) contam como um toque só.
- Bola na linha é dentro. Fora, antena, poste, bola passando por fora da antena ou por baixo da rede: ponto do adversário de quem tocou por último.
- Mão do jogador atravessando a rede durante o rally é falta.
- Quem ganha o rally saca. Ao recuperar o saque, o time alterna o sacador. No set seguinte inverte quem começa.
- Mensagens no ar sobre a rede: **SAQUE**, **SEU SAQUE**, **PONTO!**, **PONTO DELES**, **SET POINT**, **FIM DO SET**, **FIM DE JOGO**, com o motivo do ponto.

## Bots

- A cada toque, os bots preveem a trajetória com o mesmo modelo aerodinâmico da física (erro medido ≤ 7 cm) e escolhem quem vai na bola, onde ficar e quando saltar ou mergulhar.
- Movimento com aceleração limitada, corrida frontal e lateral, salto balístico para atacar e bloquear, mergulho quando não chegam em pé. Animações procedurais de manchete, toque, cortada, bloqueio, mergulho, comemoração e desânimo.
- **Jogam para você:** passes altos e levantamentos no ponto de ataque perto da sua cabeça; ataques rivais vão na direção de quem defende, com força e ângulo que dependem da dificuldade.
- **Parceira que não rouba:** a Duda só vai numa bola que passa perto de você se você estiver bem mais longe dela, e nunca na primeira bola que é sua.
- **Nunca erram de propósito.** Os erros vêm só dos limites de cada dificuldade: tempo de reação, velocidade de corrida, leitura do ataque, alcance, precisão e posicionamento do bloqueio.

Balanço medido em partidas completas simuladas (4 bots): rally médio de 7 a 9 toques, placares 18–21, 16–21 e 13–21 em Fácil, Normal e Difícil, com quase todos os pontos decididos em bola no chão.

## Áudio, visual e conforto

- Áudio 3D (HRTF) todo sintetizado no código: ondas, gaivotas, vento, torcida que cresce com o rally e explode no ponto, apito, impacto de manchete, toque, cortada, areia, rede e poste.
- Torcida de cerca de 200 pessoas nas arquibancadas em 5 draw calls, animada no vertex shader (pulos e braços para cima no ponto).
- Placar 3D gigante no fundo, nomes sobre os atletas, relógio de pulso com placar, rastro da bola nas cortadas, anel de impacto, brilho da bola e da mão no contato, vibração nos controles.
- Replay em câmera lenta (40%) dos lances bons: rally longo, cortada ou bloqueio. Pode ser desligado no menu.
- Desempenho: física a 120 Hz em passo fixo, 90 Hz quando o Quest oferece (cai para 72 Hz se não sustentar), foveation dinâmica, instancing, pools de partículas e efeitos, céu assado uma vez, sem shadow map.

## Arquitetura

```text
src/
├── main.js                   Boot: física WASM → cena → menu
├── config.js                 Medidas FIVB, física, dificuldades, regras, times
├── core/
│   ├── Game.js               Monta os sistemas, modos (treino, partida, demo) e o loop
│   ├── EventBus.js           Eventos entre sistemas
│   └── PerformanceGovernor.js  Foveation, 90→72 Hz, pixel ratio no PC
├── physics/                  Rapier 120 Hz, bola com CCD, aerodinâmica, previsão e solucionador
├── world/                    Céu, mar, areia, quadra, cenário, torcida, texturas procedurais
├── effects/                  Partículas de areia, rastro e anéis de impacto
├── gameplay/
│   ├── HitSystem.js          Colisão contínua bola × mãos/bloqueio (4 amostras por subpasso)
│   ├── PlayerStriker.js      Classifica o golpe (manchete, toque, cortada) e aplica a assistência
│   ├── Match.js              Regras, placar, sets, rodízio de saque
│   ├── Replay.js             Gravação e câmera lenta
│   └── BallMachine.js        Máquina de saque do treino
├── bots/
│   ├── Athlete.js            Atleta low-poly com poses e animação procedural
│   ├── Bot.js                Corpo do bot: locomoção, salto, mergulho
│   └── BotDirector.js        IA do time: quem vai na bola, alvos, bloqueio, saque
├── xr/
│   ├── XRSessionManager.js   Sessão, fallback para controles, 90 Hz
│   ├── HandRig.js            25 juntas por mão, colisores, posturas, visual próprio das mãos
│   └── Locomotion.js         Snap-turn, teletransporte, recentrar, fade
├── audio/AudioEngine.js      Áudio espacial sintetizado
├── ui/                       Menu do PC, menu VR, placar 3D, faixa de mensagens, relógio de pulso
└── desktop/DesktopView.js    Câmeras do PC (vitrine, jogador, TV, rede, transmissão)
```

No console do navegador (modo dev), `game.simulate(segundos)` avança só a simulação, sem desenhar. Foi usado para testar partidas inteiras.

## O que foi verificado e o que falta

Verificado no PC (Chrome headless): build sem erros, partidas completas da demo nas três dificuldades sem erros de console, regras e rodízio de saque, menu do PC, placar, câmeras e a renderização do menu VR.

Ainda não testado em um Quest real:

- a sensação dos golpes com as mãos (limites de postura e velocidade podem precisar de ajuste fino);
- o relógio de pulso, a locomoção com controles e a taxa de quadros real no headset;
- o áudio, que não foi ouvido; só se verificou que roda sem erros.
