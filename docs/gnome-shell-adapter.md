# Vale a pena usar o `GnomeShellAdapter`?

> Documento de decisão arquitetural. Avalia, com fontes, se a abstração
> `GnomeShellAdapter` / `ShellEnvironment` (a camada de injeção de dependência que
> embrulha o singleton global `Main`) compensa para esta extensão.
>
> Data: 2026-05-31 · Status: **decidido — Opção C aplicada** (adapter removido)

> **Decisão (2026-05-31):** o `GnomeShellAdapter`/`ShellEnvironment` foi **removido**
> (Opção C). Justificativa do mantenedor: os testes de integração rodam um GNOME Shell
> real via `gnome-shell-test-tool` — o problema histórico de "não dá para testar com o
> shell" ficou no passado — e a lógica pura é coberta por unit tests (`node --test`), com
> tipos vindos de `@girs`. `noOverview` e `privacyPanel` passaram a importar `Main`
> diretamente; `ExtensionContext` mantém apenas `settings` e `signals`. O restante deste
> documento é a análise que levou à decisão.

---

## 1. O que é o adapter aqui

`src/core/adapters/shell.ts` define a interface `ShellEnvironment` e a implementação
`GnomeShellAdapter`, que embrulha um punhado de APIs do objeto global `Main`
(`resource:///org/gnome/shell/ui/main.js`):

```ts
export interface ShellEnvironment {
  readonly isStartingUp: boolean;     // Main.layoutManager._startingUp
  hasOverview: boolean;               // Main.sessionMode.hasOverview
  hideOverview(): void;               // Main.overview.hide()
  onStartupComplete(cb: () => void): number; // Main.layoutManager.connect('startup-complete', …)
  disconnect(id: number): void;
}
```

Os módulos recebem isso via `ExtensionContext` (`this.context.shell`) em vez de
importar `Main` diretamente. O objetivo declarado no próprio arquivo é:

> *"Abstracting this allows us to test modules without a real GNOME Shell instance."*

A pergunta deste documento é: **esse objetivo está sendo cumprido, e o custo se paga?**

---

## 2. Contexto: por que testar extensões GNOME é difícil

A motivação original do adapter (testabilidade) só faz sentido se entendermos por que
testar código de extensão é difícil. As limitações são reais e documentadas:

- **O processo do shell não é importável fora dele.** A documentação oficial de
  depuração afirma: *"The GJS console is a separate process, without access to the
  `gnome-shell` process or the ability to import JavaScript modules used by
  extensions."* ([gjs.guide – Debugging][gjs-debug])
- **Você não consegue importar `Main`/`St`/`Shell` num runner de teste normal (Node,
  vitest).** Como a comunidade resume: *"it is impossible for gjs to import some things
  (for example `imports.gi.St`), so you will only be able to test files which don't
  import any stuff gjs can't import."* ([javascript-list, GNOME mailing list][gjs-ml])
- **A própria documentação de extensões praticamente não fala de testes unitários** — o
  fluxo oficial recomendado é abrir um novo processo do shell para carregar mudanças
  ([gjs.guide – Debugging][gjs-debug]).

Ou seja: qualquer arquivo que faça `import * as Main from '…/ui/main.js'` **não pode ser
carregado** num teste unitário fora do shell. É exatamente esse problema que um adapter
+ injeção de dependência tenta contornar: se o módulo depende de uma *interface* sua
(`ShellEnvironment`) e não do `Main` real, o teste pode injetar um dublê e exercitar a
lógica sem o shell.

Esse é o **argumento teórico a favor**, e ele é legítimo: injeção de dependência é a
forma canônica de tornar testável código preso a dependências globais. Martin Fowler:
*"A common reason people give for preferring dependency injection is that it makes
testing easier… to do testing, you need to easily replace real service implementations
with stubs or mocks."* ([Fowler – Inversion of Control & DI][fowler-di])

---

## 3. Argumentos A FAVOR do adapter

1. **Testabilidade da lógica de orquestração.** Módulos como `noOverview` têm lógica de
   máquina de estados ("se está iniciando, esconda o overview; quando o startup
   completar, restaure") que vale a pena testar sem subir o shell. Com o adapter, dá
   para injetar um `ShellEnvironment` falso e verificar a sequência de chamadas.

2. **Mockar o que você *é dono*, não o GNOME.** A regra amplamente repetida é *"don't
   mock what you don't own"*: você só deve criar dublês de tipos do seu próprio código,
   não de bibliotecas de terceiros, porque APIs alheias mudam sem aviso e os mocks ficam
   frágeis ([objc.io – Test Doubles][objc-doubles]; [TDD anti-patterns][codurance]). O
   `ShellEnvironment` é justamente um tipo **seu** que fica na fronteira com o GNOME —
   um "port" no sentido de arquitetura hexagonal. Testar contra ele respeita essa regra;
   tentar mockar `Main` diretamente a violaria.

3. **Documenta a superfície de acoplamento.** A interface lista explicitamente *quais*
   pedaços do shell o código depende. Isso vira um inventário de risco útil quando uma
   nova versão do GNOME muda APIs internas (ver [Release Policy][agents] — features
   acompanham o ciclo do GNOME).

4. **Ponto único de adaptação a quebras de versão.** Se `Main.layoutManager._startingUp`
   sumir num GNOME futuro, conserta-se em um arquivo, não em N módulos.

---

## 4. Argumentos CONTRA (como está hoje)

Aqui entra a evidência específica deste repositório — e ela é desfavorável.

1. **O benefício (testes) NÃO está sendo colhido.** Não existe **nenhum** teste unitário
   que injete um `ShellEnvironment` falso. Os testes em `tests/unit/`
   (`metadata`, `monitorTopology`, `registry`, `schema`, `trayState`) ou (a) analisam
   código-fonte como texto, ou (b) testam lógica pura que já não depende do shell. A
   cobertura real de comportamento vem dos **testes de integração** em `tests/shell/`,
   que rodam um `gnome-shell` de verdade headless — e portanto **não precisam do adapter
   para nada**. Uma abstração cujo único propósito é testabilidade, sem um único teste
   que a use, é custo sem retorno.

2. **A abstração cobre quase nada.** Apenas **2 de 13 módulos** usam `this.context.shell`
   (`noOverview` e `privacyPanel`). A interface expõe ~4 chamadas. Enquanto isso, **~12
   módulos importam `Main` diretamente** (`dock`, `trayIcons`, `volumeMixer`, `privacy`,
   `clipboardHistory`, `bluetoothMenu`, `appSearchTooltip`, etc.) e usam dezenas de APIs
   (`Main.panel`, `statusArea`, `addToStatusArea`, `wm`, `uiGroup`, `overview`, …). A
   "fronteira" está cheia de furos: o adapter dá uma falsa sensação de desacoplamento.

3. **Importar `Main` direto é prática aceita e idiomática.** A documentação oficial e
   praticamente toda extensão fazem `import * as Main from
   'resource:///org/gnome/shell/ui/main.js'` ([gjs.guide – Imports & Modules][gjs-imports]).
   Não é um anti-padrão a ser exterminado; é a API pública de fato para extensões.

4. **Custo de consistência e parmetragem.** Ter uma regra de DI no `AGENTS.md`
   ("módulos **não devem** acessar `Main` diretamente") que **11 de 13 módulos violam**
   gera ruído: revisões apontam "violação", contribuidores ficam em dúvida sobre qual
   padrão seguir, e o adapter precisa crescer toda vez que um módulo "bem-comportado"
   precisa de uma API nova. Expandir o adapter para cobrir `panel`, `statusArea`, `wm`,
   etc., seria reescrever muito código para espelhar a API do `Main` — um *wrapper
   anêmico* que só repassa chamadas, o tipo de indireção que adiciona manutenção sem
   adicionar valor.

---

## 5. Análise

O adapter é uma boa ideia **mal calibrada para esta base de código**. O padrão (port na
fronteira + DI) é correto e alinhado às melhores práticas — *quando há testes que o
exercitam*. Hoje não há, e a superfície coberta é pequena demais para o adapter ser uma
fronteira real.

Os testes de integração em `gnome-shell` headless já entregam a confiança que o adapter
prometia entregar via unit tests, **e cobrem os 13 módulos**, não 2. Para extensões, esse
é frequentemente o trade-off certo: o ambiente é tão entrelaçado com o shell que testar
contra um shell real (como o próprio GNOME faz, com serviços mockados via
python-dbusmock — [Automated testing of GNOME Shell][gnome-auto]) rende mais que erguer e
manter uma camada de abstração para unit tests que ninguém escreve.

> Princípio aplicável: a abstração deve pagar seu custo. *"With your codebase, you
> probably have a sense of how stable or volatile different interfaces are, so you can
> use your gut feeling about when using a double might lead to brittle tests."*
> ([objc.io][objc-doubles]) Uma abstração sem consumidor de teste é volatilidade pura.

---

## 6. Recomendação

Três caminhos coerentes (escolher um — **não** ficar no meio-termo atual):

### Opção A — Cumprir a promessa (manter e *usar* o adapter)
Faz sentido **se** houver intenção real de escrever unit tests de lógica de módulos.
- Escrever de fato testes que injetem um `FakeShellEnvironment` (ex.: testar a máquina de
  estados do `noOverview`/`privacyPanel`).
- Expandir o adapter **apenas** onde houver lógica que valha testar isolada — não tentar
  espelhar todo o `Main`.
- Manter a regra de DI no `AGENTS.md`, mas reescrita para refletir que ela vale para
  *lógica testável*, não para todo toque em `Main`.

### Opção B — Encolher para uma fronteira honesta (recomendada)
Manter o adapter **só** para o que tem lógica não-trivial de ciclo de vida
(`isStartingUp` + `onStartupComplete`, usados por `noOverview`/`privacyPanel`), e
**parar de fingir** que os outros módulos não usam `Main`.
- Reescrever a regra do `AGENTS.md`: importar `Main` diretamente é permitido e idiomático;
  o `ShellEnvironment` existe apenas para encapsular o handshake de *startup* (que é
  chato de testar e propenso a quebrar entre versões).
- Resultado: zero reescrita grande, a regra para de ser violada por 11 módulos, e a
  abstração passa a ter um escopo defensável.

### Opção C — Remover o adapter
Se não houver plano de unit tests de comportamento, remover `ShellEnvironment` e fazer
`noOverview`/`privacyPanel` importarem `Main` como os demais.
- Menos uma camada, menos uma regra violada, confiança vem 100% dos testes de integração.
- Custo: perde-se o ponto único de adaptação ao *startup handshake* entre versões do
  GNOME — o único lugar onde o adapter agrega valor concreto hoje.

**Sugestão:** **Opção B**. Ela alinha a regra à realidade (importar `Main` é normal),
elimina o atrito de revisão, e preserva a abstração exatamente no único ponto em que ela
paga seu custo: o ciclo de *startup*, que é genuinamente irritante de testar e sensível a
versão. As Opções A e C são defensáveis conforme a equipe decida investir (A) ou não (C)
em unit tests de lógica de módulo.

---

## Fontes

- [gjs.guide — Debugging extensions (limitações do console GJS / testes)][gjs-debug]
- [gjs.guide — Imports and Modules (import de `Main` via `resource://`)][gjs-imports]
- [gjs.guide — Review Guidelines (regras de `enable`/`disable`, recursos)][gjs-review]
- [GNOME mailing list — Unit testing under GJS (não dá para importar `imports.gi.St`)][gjs-ml]
- [GNOME Shell & Mutter — Automated testing of GNOME Shell (mocks via python-dbusmock)][gnome-auto]
- [Martin Fowler — Inversion of Control Containers and the Dependency Injection pattern][fowler-di]
- [objc.io — Test Doubles: Mocks, Stubs, and More ("don't mock what you don't own")][objc-doubles]
- [Codurance — TDD anti-patterns (fragilidade de mockar dependências externas)][codurance]

[gjs-debug]: https://gjs.guide/extensions/development/debugging.html
[gjs-imports]: https://gjs.guide/extensions/overview/imports-and-modules.html
[gjs-review]: https://gjs.guide/extensions/review-guidelines/review-guidelines.html
[gjs-ml]: https://mail.gnome.org/archives/javascript-list/2017-December/msg00000.html
[gnome-auto]: https://blogs.gnome.org/shell-dev/2022/12/02/automated-testing-of-gnome-shell/
[fowler-di]: https://martinfowler.com/articles/injection.html
[objc-doubles]: https://www.objc.io/issues/15-testing/mocking-stubbing/
[codurance]: https://www.codurance.com/publications/tdd-anti-patterns-chapter-2
[agents]: ../AGENTS.md
