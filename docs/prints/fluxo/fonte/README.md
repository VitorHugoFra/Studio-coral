# Fonte dos diagramas de fluxo

Cada diagrama é uma página HTML; o `render.js` abre a página no Puppeteer e salva o PNG em alta resolução.

- `leigos.html` → `fluxo-leigos.png`: como funciona, por raias (agência, restaurante, cliente final, plataforma).
- `tecnico-arquitetura.html` → `fluxo-tecnico-arquitetura.png`: as peças do sistema e como se ligam.
- `tecnico-sequencia.html` → `fluxo-tecnico-sequencia.png`: sequência das chamadas, de uma campanha a um pedido pago (Mermaid).

Para gerar de novo, na raiz do repositório (precisa de internet para as fontes e o Mermaid):

```bash
node docs/prints/fluxo/fonte/render.js docs/prints/fluxo leigos.html tecnico-arquitetura.html tecnico-sequencia.html
```
