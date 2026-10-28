# Blocked Pixel Warriors (3D)

> Voxel helicopter vs. armored train arcade shooter — Three.js / WebGL2, tek dosyalık build.
> Repo: https://github.com/arargame/blockedpixelwarriors

Voxel helikopter vs. zırhlı tren arcade shooter. Three.js (WebGL2) ile yazıldı, sahne
`captures/ref/keyart.png` key art'ına göre kuruldu: aynı kamera açısı, küp dizilimi,
tren, helikopter, adalar, ışık ve renk tonları.

![poster](captures/final_poster.png)

## Hemen oyna

`dist/index.html` dosyasına çift tıkla. Sunucu gerekmez, tüm kod ve dokular tek dosyada
(dokular çalışma anında prosedürel üretiliyor, harici asset yok).

- **Kontroller (klavye, pilot tarzı — helikopterin kendi gövdesine göre):**
  - **W** burnun baktığı yöne ileri, **S** kuyruğa doğru geri, **A / D** gövdenin soluna / sağına yanlama
  - **← / →** helikopteri döndürür (Q / E de çalışır); ↑ / ↓ kullanılmaz
  - Dokunmatik / fareyle sürükleme: ekrana göre joystick, burun gidilen yöne döner.
  Ayarlar `GameConfig.heli` (speed, accel, keyTurnRate). Doğrulama: `node tools/controltest.mjs`. Silahlar otomatik ateş eder:
  - Varsayılan: kanat altı podların önünden tek atış, sağ/sol sırayla.
  - **Akıllı nişan:** Hedefe dönmen yeterli. Burnun ±17°'lik konisinde 18 birime kadar en uygun hedef
    kilitlenir (tren parçaları öncelikli), namlular yukarı/aşağı ve birkaç derece yana açı alıp onun
    merkezine ateş eder; kilitli hedefte dönen beyaz köşeli nişangâh görünür. Nişanlı atışlar gerçek 3D
    çarpışma kullanır, yani aradaki blokların üstünden geçip trendeki üst üste kargo küplerine ulaşır.
    Kilit yoksa düz ileri atar. Ayar: `GameConfig.heli.aimCone / aimRange`.
- **Supply'lar:** **Supply blokları** (yıldızlı, altın çerçeveli) patlayınca her zaman bir supply düşer; tür eşit dağılır
  (5 tür = %20'şer; `PowerUps.js` → `POWERUPS` listesine eklenen her tür otomatik havuza girer).
  **Mıknatıs (Blocked'daki gibi):** helikoptere ~5 birim yaklaşınca supply sabit bir çekimle sana doğru
  kıvrılarak gelir ve toplanır. T/D/R/G 8-15 sn arası rastgele süre etkin kalır:
  - **T – Triple Fire:** alttaki burun topundan 3'lü yelpaze plazma
  - **D – 8-Way Burst:** 8 yöne ateş; her yön o taraftaki hedefe göre yukarı/aşağı nişan alır
  - **R – Homing Rockets:** yakındaki rastgele hedeflere güdümlü füzeler (Blender'da modellenen roket,
    `tools/blender/build_rocket.py` → `assets/models/rocket.glb`, duman izi ve alevle)
  - **H – Repair Kit:** Blocked'daki ilk yardım çantasının 3D hali, anında **+35 can**
  - **G – Gem Power:** Blocked Pixel Panzer 3D'deki sekizgen elmas (5 renk). Süre boyunca tüm
    ateşler (normal, T, D) elmasın rengini alır ve %25 fazla hasar verir
  - Sağ altta etkin olanlar sohbet akışı gibi listelenir (ince beyaz çerçeveli bar).
  Ayarlar: `GameConfig.supply` (dropChance, magnetRadius/Accel/Damping, healAmount, gemDamageMul).
  Doğrulama: `node tools/poweruptest.mjs`.
- **HUD:** Sol altta helikopterin canı (100 can, 5'erlik 20 parça; %25 altında kırmızı yanıp söner ve
  helikopterden ince kara duman çıkar). Üstte **zırhlı tren paneli**: soldan sağa vagon vagon
  kutular, her kutuda o vagonun parçaları (elmas, taretler, renkli kargo küpleri) dikey çubuk olarak;
  hasar aldıkça azalır, yok olunca boş kalır, tamamen biten vagonun üstü çizilir; sağda toplam yüzde.
- **Bloklar:** 3 tip: normal, **zırhlı** (çelik kafesli, ~3 kat dayanıklı) ve **supply bloğu**
  (her yeni blok için %20 şans; zırhlı %20, kalan normal). Bir blok patlayınca ona **değen aynı renkteki
  bloklar zincirleme** patlar (her halka daha çok puan). Tahtadaki bloklar kendiliğinden geri gelmez:
  yeni bloklar sadece trenden gelir.
- **Tren:** A ile B arasında mal taşır gibi her turda yön değiştirir (önce uzaktan gelir, sonraki
  tur kamera tarafından geri döner). Her tur rastgele **FAST** (hiç durmaz), **NORMAL** veya **SLOW**;
  normal/yavaş turlarda tahta üzerinde **3 sn durabilir**, dururken taretler 2,5 kat hızlı ateş eder.
  Geçerken rayın sağındaki iki sütunda boşalan karelere vagonlardan yeni blok bırakır.
  **Trene çarpmak 25 can** götürür: helikopter geri savrulur, 1,5 sn yanıp söner. Her hasarda ekranda
  Blocked'daki gibi kırmızı vinyet belirip 2 sn'de söner.
  Yandaki **sarı pirinç toplar** 1,2-2,8 sn'de bir, helikopter kendi tarafındaysa ona nişanlı ağır
  gülle atar (10 hasar); taretler sürekli sana döner ve ateş eder.
  Aynı tren, lokomotifteki elmas yok edilene (%0) kadar tekrar tekrar gelir. Yok edilen tren yanarak
  hızlanır ve birkaç saniyede sahneyi terk eder. Yok ettiğin
  taretler ve elmasa verdiğin hasar kalır; kargo vagonları her turda yeni küplerle dolu gelir. Kargo
  küplerini vurunca küp trenden düşüp tahtada en yakın boş kareye yeni blok olarak oturur.
  Üstteki panel tur sayısını (LAP), hız modunu (FAST/NORMAL/SLOW/HALT) ve trenin kalıcı sağlığını gösterir.
- **Hedef:** Lokomotifin önündeki **kırmızı mücevheri** vurarak treni yok et, sonraki dalgada yeni tren gelir.

## Geliştirme

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/index.html (tek dosya)
```

URL parametreleri:

| Parametre | Açıklama |
|---|---|
| `?quality=high\|medium\|low` | Render kalitesi (telefonda otomatik `medium`) |
| `?poster&logo` | Key art karesini sabit olarak render eder (karşılaştırma için) |
| `?cam=x,y,z,pitch,yaw,fov,lensK` | Kamera ayarını kod değiştirmeden dene |

## Görsel teknikler

- **Kamera + lens:** Key art'a `tools/overlay.mjs` ile oturtuldu (geniş açı, soldan, sağa dönük)
  ve üstüne hafif barrel lens bükmesi (`LensPass`) eklendi; poster'deki "diorama" geniş açı hissi bu.
- **Arka plan eğimi:** Gökyüzü + adalar ayrı bir grupta kameraya doğru 17° eğik. Böylece tahta
  dik açıdan görünürken adaların kayalık yüzleri, şelaleler ve ufuk aynı karede görünüyor
  (AI görselindeki perspektif hilesi).
- **Zemin:** Mermer fotoğrafından kalebodur karolar (`TileFloorMaterial.js`): blok ızgarasıyla hizalı
  1,5 birimlik kareler, her karoda fotoğrafın farklı bir bölümü ve 90°'lik rastgele dönüş, derz ve pah.
- **Küpler:** Yuvarlatılmış instanced küpler, Voronoi çatlaklı normal map, yumuşak kar yığınları.
- **Araçlar:** `VoxelModelBuilder` ile bevel'li kutulardan kuruluyor, `VoxelMaterial` her yüzeye
  mikro-voxel desen + derz basıyor. Tren: çerçeveli kırmızı mücevher, ışık sırası, kırmızı gözler,
  pirinç toplar, bacalar. Helikopter: kanat altı roket/gatling podları, sürekli egzoz alevi.
- **Kar:** Dalgalar halinde gelip giden hafif kar yağışı. Raylarda her travers aralığı rastgele bir
  miktara kadar birikir (bazı yerler hep boş, yamalı görünür); yağış yokken sadece ince bir serpinti
  kalır. Tren geçerken kar erir/savrulur, 2-9 sn sonra yeni rastgele miktarla yeniden dolar. Ara sıra
  5-12 sn süren tipiler gelir: kar hem yoğunlaşır hem hızlanır (`src/world/Snow.js`).
- **Arka plan:** Ufukta kayarak geçen bulut kümesi, şelaleli mesa adalar, derin mavi gökyüzü.
- **Efektler:** Pembe-mavi plazma kuyruklu yıldızlar, turuncu tracer'lar, ateş topları,
  kırılan küp parçaları, baca dumanı.
- **Post-processing:** MSAA + HDR → ön plan bulanıklığı (çam ağaçları) → bloom → renk grade →
  lens → ACES tone mapping.
- **Logo:** `src/ui/VoxelLogo.js` canvas üzerinde voxel harfler çiziyor (tank figürlü A dahil).

## Helikopter modeli (Blender)

Helikopter Blender'da modellendi: `tools/blender/build_heli.py` → `assets/models/helicopter.blend` + `.glb`.
Oyun `.glb`'yi yükler (`src/entities/HelicopterGltf.js`); yüklenemezse eski prosedürel modele döner
(`?procedural` ile zorlanabilir). Ayrıntılar: `tools/blender/README.md`.

## Klasörler

```
src/core       Game (ana döngü), RenderPipeline, Input, post-process pass'leri
src/world      Tahta, ray, adalar, çamlar, bulutlar, gökyüzü (World facade)
src/entities   Helikopter, tren, blok alanı, dikenli toplar
src/fx         Partikül, mermi, enkaz, billboard batch
src/textures   Prosedürel doku ve materyal kütüphanesi
src/ui         HUD ve voxel logo
src/config     GameConfig (yerleşim/kamera), Palette (tüm renkler)
tools          screenshot, overlay (kamera eşleme), playtest, verify-dist
```

Renkler `src/config/Palette.js`, kamera ve tahta yerleşimi `src/config/GameConfig.js`,
küp haritası `src/entities/BlockField.js` içindeki `MAP` dizisinde.

## Araçlar (headless Chromium)

```bash
node tools/screenshot.mjs captures/out.png 1672 941 "&logo"   # poster karesi
node tools/overlay.mjs -8.6,11.7,13.8,42,19,60,0.18 out.png    # yerleşimi key art üstüne çiz
node tools/playtest.mjs                                        # oynanış smoke test
node tools/verify-dist.mjs                                     # dist dosyasını file:// ile aç
```

## Referansla bilinen farklar

Key art bir AI illüstrasyonu; perspektifi fiziksel olarak tutarlı değil (sol duvar, uzak duvar
ve ray tek bir kamerayla aynı anda o açılarda görünemiyor). Kamera bu yüzden en yakın tutarlı
çözüme oturtuldu. Boyalı detay seviyesi (kayalardaki fırça dokusu, her çamın ayrı çizimi) gerçek
zamanlı render'da birebir değil; yerleşim, açı, renkler ve objelerin tasarımı aynı.
