# Blocked Pixel Warriors — MonoGame (Desktop + Android)

Web sürümünün (Three.js) MonoGame portu. Aynı kamera, aynı ışık/gölge, aynı post-process zinciri
(bloom, renk düzenleme, lens bükmesi, ACES) ve aynı modeller — içerik doğrudan çalışan web
sahnesinden dışa aktarılır, bu yüzden görüntü web ile birebir aynıdır.

## Projeler

| Klasör | Ne |
| --- | --- |
| `BlockedPixelWarriors.Shared/` | Tüm oyun kodu + içerik (Desktop ve Android ortak) |
| `BlockedPixelWarriors.Desktop/` | DesktopGL (Windows / Linux / macOS) giriş noktası |
| `BlockedPixelWarriors.Android/` | Android (yatay, tam ekran, dokunmatik kontroller) |
| `Shaders/` | Elle yazılmış GLSL efektleri (`.glfx`) |
| `Tools/EffectPacker/` | `.glfx` → MonoGame `.mgfx` paketleyici (MGCB / mgfxc gerekmez) |

`BlockedPixelWarriors.sln` hepsini açar. Desktop: `dotnet run --project BlockedPixelWarriors.Desktop`.
Android: Visual Studio'da Android projesini başlangıç projesi yapıp cihaza deploy edin
(OpenGL ES 3.0 gerekir).

## İçerik (Shared projede yönetilir)

- `Content/` — tam kalite: `Models/*.bpm|*.bpi`, `Textures/*.png`, `Fonts/`, `Data/scene.json`,
  `Data/environment.bin` (ortam ışığı), `Effects/*.mgfx`.
- `Content.Mobile/` — telefon sürümleri: yarı boyutlu dokular ve `MOBILE` shader varyantları
  (2x2 PCF gölge, tek örnekli renk düzenleme). Android projesi bunları `Content/` altına paketler,
  kod hangi seti aldığını bilmez.

İçerik web sahnesinden üretilir (web'de bir model / doku değiştiğinde):

```bash
node tools/export-monogame.mjs     # depo kökünden; modeller, dokular, fontlar, sahne verisi
MonoGame/pack-shaders.sh           # veya pack-shaders.ps1 — shader'ları paketler
node tools/glsl-validate.mjs <dir> # (opsiyonel) EffectPacker --dump çıktısını GLSL ES ile doğrular
```

## Kontroller

- **Klavye:** W/S ileri-geri, A/D yana kayma (helikopterin kendi yönüne göre), Q/E veya ←/→ dönüş.
  ESC / P duraklat (Devam / Yeniden başla / Ana menü, M), F11 veya Alt+Enter tam ekran.
- **Ana menü:** ↑/↓ (W/S) satır (OYNA · AYARLAR · OYUNDAN ÇIK), ←/→ (A/D) kartlar, ENTER / Space aç,
  ESC / Backspace geri, C kayıttan devam. Fare / dokunma: plakaya ya da karta dokun, kaydırarak gez,
  tekerlek ile kartlar. Android geri tuşu menüde paneli kapatır, yoksa çıkış sorusunu açar.
- **Fare:** sürükleme = ekran yönlü sanal joystick (web'deki gibi).
- **Dokunmatik (Android):** sol yarıda başparmağın değdiği yerde beliren sanal joystick
  (helikopter ekranda o yöne gider, burun hareketi takip eder); sağ alttaki iki büyük buton
  sola / sağa döndürür (Q / E). Sağ üstte duraklatma. Çoklu dokunma: joystick ve dönüş birlikte.
  Android geri tuşu duraklatır; oyun bitince menüye döner. Uygulama arka plana geçince oyun durur.

## Mimari

- `GameSession` oyunun kompozisyon kökü ve çarpışma **Mediator**'ı (Game.js portu).
- Sistemler: `Helicopter`, `Train` (+ `TrainFactory`), `BlockField` (O(1) ızgara sorgusu, zincir
  patlama), `ProjectileSystem` (havuzlu, alt adımlı çarpışma), `SupplyCrates` / `PowerUpSystem`,
  `Targeting` (akıllı nişan, değer tipi hedefler — tahsis yok).
- Efektler: `Effects` cephesi → `ParticleSystem` (struct havuzu, swap-remove, tek draw call),
  `DebrisSystem` (instancing), flaş noktasal ışıklar.
- Çizim: varlıklar `IRenderable.Submit(RenderQueue)` ile çizim kuyruğuna ekler; `SceneRenderer`
  gölge haritası → (önplan bulanıklığı) → opak → saydam/billboard sıralı → `PostProcessor`.
  Adalar, çamlar, bloklar, kargo küpleri, enkaz donanımsal instancing ile çizilir.
- `ModelLibrary` modelleri bir kez GPU'ya yükleyip paylaştırır (Flyweight).
- `MainMenu` (MainMenu.js portu): soldaki logo ve eğik plakalar, sağda kart karuseli (yükseltme
  kartı modeli fiyonksuz, `CardPicker.DrawCard` ile çizilir), senaryo kartının altında bölüm
  ışıkları (DEPO → TERAS → BOSS, ulaşılanlar yanar), açılan paneller (brifing + YENİ OYUN / DEVAM,
  ses, grafik, dil, çıkış). Arkada oyun kendi kendine oynar (depo, geçen trenler) ve kül-gri olur.
  Yerleşim `MainMenu.Layout.Compute` web'deki `menuLayout` ile aynı. Kart yüzleri (dil başına)
  ve metinler web'den dışa aktarılır (`card_menu_<id>_<lang>`, `scene.json` → `prefabs.menu`).
- Ayarlar: `Core/Settings.cs` → `%LOCALAPPDATA%/BlockedPixelWarriors/settings.json` (dil, ses
  seviyeleri, kalite, kamera sarsıntısı, tam ekran) ve `progress.json` (senaryo ilerlemesi). Kalite
  bir sonraki açılışta uygulanır. Oyunda henüz ses yok; ses seviyeleri sesler için saklanır.
  Dil şimdilik menüyü çevirir (EN / TR); oyun içi yazılar İngilizce.
- UI: `Hud` (web HUD'unun SpriteBatch portu), `UiKit` (9-slice paneller, bitmap fontlar),
  `GameInput` + `TouchControls`.

### Web ile farklar

- MonoGame GL yalnızca 8-bit MSAA hedefi oluşturabildiği için HDR sahne MSAA yerine **FXAA** ile
  yumuşatılır (bloom HDR'de kalır). Telefonda (web "low" preset gibi) FXAA, önplan bulanıklığı yok,
  1024 gölge haritası, en fazla 720 satır render + dinamik çözünürlük.
- **Bölümler:** 1. bölüm depo (20 kırmızı + 20 yeşil + 20 mavi paket, sol altta onay kutulu
  görev listesi); bitince kamera helikopteri takip eder, raylar boyunca ahşap köprüden yukarı
  uçulur, kontrol noktası kapısından geçince kayıt alınır (CONTINUE ile oradan devam) ve 2. bölüm
  "Terrace" başlar: iki yanı balkonlu geniş platform, BLOCK HAULER treni (taretler + gülle sallayan
  vinçler, gülle çarparsa hasar). Kayıt dosyası: `%LOCALAPPDATA%/BlockedPixelWarriors/checkpoint.json`
  (Android'de uygulama klasörü).
- Oyun web sürümüyle aynı: helikopter, tren (taret, top, mücevher kalkanı, turlar), bloklar,
  mermiler, ikmaller (T / D / R / H / G), **yükseltme kartları** (8 kart, kül-gri dünya, tıkla /
  dokun / 1-2, resmin tamamını görme), **saha mühendisi + forklift** (BFS ile kargo toplar,
  rıhtıma hediye paketi dizer), **CH-47F Chinook** (forklifti getirir, 2 dakikada bir paket
  toplar, geri sayım), görev paneli (100 kırmızı / yeşil / mavi → MISSION COMPLETE),
  DOUBLE ROW, GEM MINE, HOMING ROCKETS, FLICKER, RUSH DELIVERY, SURPRISE EGG (dikenli toplar),
  HUD, menüler, kar.
- Kartlar sahnenin post zincirinden sonra tam çözünürlükte çizilir (`Card.glfx`: key + rim ışık,
  RoomEnvironment, clearcoat, fragment başına ACES + sRGB — web'deki ayrı kart canvas'ı gibi).

## Test / ekran görüntüsü

```bash
BlockedPixelWarriors --capture out.png --frames 3 --scenario static|poster|menu|play|cards|logistics|transit|terrace [--warmup 25] [--extra 30] [--pick 0] [--touch] [--mobile]
# menü: tuş betiği ve dil (save = 2. bölüm kaydı + ilerleme)
BlockedPixelWarriors --capture menu.png --frames 3 --scenario menu --lang tr --menu down,right,enter
node tools/staticshot.mjs web.png   # aynı "static" kareyi web sürümünden alır (karşılaştırma)
```
