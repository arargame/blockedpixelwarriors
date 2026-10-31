# Blocked Pixel Warriors (3D)

> Voksel helikopter, zırhlı trene karşı: arcade nişancı oyunu. Three.js / WebGL2 ile yazıldı, tek dosyalık derleme.
> Depo: https://github.com/arargame/blockedpixelwarriors

Sahne `captures/ref/keyart.png` tanıtım görseline göre kuruldu. Kamera açısı, küp dizilimi,
tren, helikopter, adalar, ışık ve renk tonları o görselle aynı.

![poster](captures/final_poster.png)

## Hemen oyna

`dist/index.html` dosyasına çift tıkla. Sunucu gerekmez: tüm kod, modeller ve dokular tek dosyanın
içinde.

### Ana menü

Açılışta ana menü gelir. Arkada depo kendi kendine oynar (tren geçer, helikopter ateş eder) ve dünya
gri olur; menü renkli kalır. Solda logo ve **OYNA · AYARLAR · OYUNDAN ÇIK** plakaları (↑/↓), sağda
satırın kartları sağa-sola kayar (←/→, kaydırma, tekerlek). **ENTER** / dokunma kartı açar, **ESC** geri.

- **OYNA:** senaryo kartları (yükseltme kartı modeli, fiyonksuz). **RAILBREAKER** (heli vs tren) oynanır;
  yanında kilitli "yakında" kartları. Kartın altında bölüm ışıkları: **DEPO → TERAS → BOSS**, ulaşılan
  bölümler yanar (teras kontrol noktasına ulaşınca 2 ışık). Kart açılınca brifing + **YENİ OYUN** /
  **DEVAM ET · BÖLÜM 2**.
- **AYARLAR:** Ses (genel / müzik / efekt; oyunda henüz ses yok, seviyeler saklanır), Grafik (kalite
  yeniden açılışta uygulanır, kamera sarsıntısı, tam ekran), Dil (English / Türkçe; şimdilik menü).
- **OYUNDAN ÇIK:** onay sorusu. Oyun bitince (GAME OVER / MISSION COMPLETE) bir tuşla menüye dönülür.

Kod: `src/ui/MainMenu.js` (yerleşim `menuLayout`, karusel, paneller), `MenuCards.js` (kartlar ve
yüzleri), `MenuText.js` (EN/TR metinler), `menu.css`, `src/core/Settings.js` (ayarlar + ilerleme).

### Oyun akışı notları

- **Pause:** ESC / P ya da sağ üstteki ❚❚ düğmesi oyunu dondurur: Devam, Ayarlar (ses / grafik / dil),
  Yeniden başla, Ana menü. Sekme gizlenince de durur.
- **Tren girişi:** tren her seferde ekranın hemen dışından girer, ekrandan çıkınca sefer biter; dönüş
  beklemesi eskisinin %80'i. Gelmeden 2.5 sn önce "TRAIN INCOMING / IS BACK" yazısı ve girdiği kenarda
  yanıp sönen **TRAIN** işareti çıkar.
- **Vagondaki kutular:** alttaki kutu vurulunca üstündekiler aşağı düşer.
- **2. bölüm (teras):** Block Hauler ile zırhlı tren sırayla gelir (her biri hasarını korur). Trenden
  vurulan kutular terasa sekip düşer ve kırılır; %60 ihtimalle ikmal (silah / tamir) bırakır.
- **Raylardaki kar** eskisinin %10'u kadar birikir (`GameConfig.track.railSnow`).

### Görev

Trenin vagonlarındaki **kırmızı, yeşil ve mavi** kutuları vurup aşağı düşür. Mühendis forkliftiyle
onları en soldaki iskele sütununa dizer, kargo helikopteri de gelip götürür. İkisi de oyunun başında
yoktur: tren yenince çıkan **FIELD ENGINEER** ve **CARGO CHOPPER** kartlarıyla gelirler.
**100 kırmızı + 100 yeşil + 100 mavi** paket teslim edilince **görev tamamlanır**.

### Kontroller (klavye, pilot tarzı: helikopterin kendi gövdesine göre)

- **W** burnun baktığı yöne ileri, **S** kuyruğa doğru geri gider, **A / D** gövdenin soluna / sağına kayar.
- **← / →** helikopteri döndürür (Q / E de çalışır). ↑ / ↓ kullanılmaz.
- Dokunmatik ekranda ya da fareyle sürükleyerek: ekrana göre joystick gibi çalışır, burun gidilen yöne döner.
- Ayarlar: `GameConfig.heli` (hız, ivme, dönüş hızı). Doğrulama: `node tools/controltest.mjs`.

### Silahlar (otomatik ateş)

- **Varsayılan:** kanat altı podların önünden, sağ ve sol sırayla tek atış.
- **Akıllı nişan:** hedefe dönmen yeterli. Burnun ±17°'lik konisinde, 18 birime kadar en uygun hedef
  kilitlenir. Namlular yukarı/aşağı ve birkaç derece yana açı alıp hedefin merkezine ateş eder; kilitli
  hedefin üstünde dönen beyaz köşeli nişangâh görünür. Nişanlı atışlar gerçek 3D çarpışma kullanır:
  aradaki blokların üstünden ve trenin zırhının yanından geçip hedeflenen parçaya ulaşır.
  Kalkan açıkken taretler elmastan önce gelir. Kilit yoksa düz ileri ateş eder.
  Ayar: `GameConfig.heli.aimCone / aimRange`.
- **Korunan kargo:** trenden düşen kırmızı/yeşil/mavi kutulara akıllı nişan, güdümlü roket ve 8 yön
  atışı **asla kilitlenmez**; zincirleme patlama ve roket sıçrama hasarı da onlara geçmez. Elle düz ateş
  ise hâlâ kırabilir. Kırılırsa ekranda **CARGO LOST!** yazar.

### Destekler (supply)

**Destek blokları** (yıldızlı, altın çerçeveli) patlayınca her zaman bir destek düşer. Türler eşit
dağılır (5 tür, %20'şer). `PowerUps.js` → `POWERUPS` listesine eklenen her tür otomatik olarak havuza girer.
**Mıknatıs** (Blocked'daki gibi): helikopter ~5 birim yaklaşınca destek sabit bir çekimle kıvrılarak sana
gelir ve toplanır. T/D/R/G 8-15 sn arası rastgele bir süre etkin kalır.

- **T – Üçlü Ateş:** burun topundan 3'lü yelpaze plazma
- **D – 8 Yön:** 8 yöne ateş; her yön, o taraftaki hedefe göre yukarı/aşağı nişan alır
- **R – Güdümlü Roket:** yakındaki rastgele hedeflere güdümlü roketler (Blender'da modellendi, duman izi ve alevle)
  — sadece **HOMING ROCKETS** kartından sonra düşer
- **H – Tamir Çantası:** anında **+35 can**
- **G – Elmas** (sadece **GEM MINE** kartından sonra düşer). Süre boyunca tüm atışlar elmasın rengini ve
  etkisini alır (Blocked'daki kurallar):
  - **Mavi – Hızlı Ateş:** silahlar 2 kat hızlı ateş eder.
  - **Yeşil – Asit:** vurulan blok yeşile döner (artık yeşil komşularıyla zincirleme patlar), limon
    yeşili parlar, köpürür ve her saniye 1-2 can kaybederek eriyip çöker. Kargo kutularına işlemez.
  - **Kırmızı – Güçlü Atış:** iri, alevli mermiler; 2,5 kat hasar ve küçük patlamalar.
  - **Siyah – Kritik:** atışların %20'si kritik vurur (3 kat hasar). Vurulan yerde kırmızı
    **CRITICAL!** yazısı çıkar, ekran sarsılır.
- Etkin olanlar sağ altta sohbet akışı gibi listelenir (ince beyaz çerçeveli çubuklar).

Ayarlar: `GameConfig.supply`. Doğrulama: `node tools/poweruptest.mjs`.

### Geliştirme kartları

Bir tren yok edilince ~1,5 sn sonra ekrana **kartlar** gelir. Oyun **durmaz**, sadece dünya rengini
kaybedip kül grisine döner; helikopteri uçurmaya devam edebilirsin. Kartlar arkası dönük olarak aşağıdan
uçarak gelir, havada dönüp yüzünü gösterir ve hafifçe süzülür. Fareyle üstüne gelince kart öne çıkar,
imlece doğru eğilir, arkası ışıldar ve yüzeyinde bir parlama geçer. **Tıkla / dokun** ya da **1 / 2**
tuşuyla seç: seçilen kart ortaya gelip parlar ve oyuna karışarak kaybolur, diğeri aşağı düşer, renkler geri gelir.

- **Resimlerin net görünmesi için:**
  - Kartlar kendi ayrı tuvalinde (canvas), cihazın tam piksel yoğunluğunda çizilir. Oyun FPS için
    çözünürlüğünü düşürse bile kartlar keskin kalır.
  - Her kartın resmi, kurdelenin üstündeki pencereye o resmin **önemli noktasına** göre yerleşir
    (`focus`) ve gerekirse biraz uzaklaşır (`zoom`); kenarlarda resmin bulanık bir kopyası kalır.
  - **İnceleme modu:** fareyle resmin üstüne gelince kurdele ve yazı kaybolur, **resmin tamamı** kartın
    üstünde görünür (Chinook'un taşıdığı kutular, sürpriz yumurtadaki toplar vb.). Yazının üstüne gelince
    yazı geri gelir. Dokunmatik ekranda resme dokun = incele, kurdeleye dokun = seç.
- **Kart modeli Blender'da** yapıldı (`tools/blender/build_card.py` → `assets/models/card.glb`): poker
  kartı inceliğinde (0,3 mm oranında), yuvarlak köşeli, kabartma altın çift çerçeve, köşe elmasları,
  tepede kart rengine göre parlayan bir taş ve kartın kenarlarından taşıp arkaya kıvrılan 3D kırmızı
  kurdele afiş. Kartın yüzü (resim, tür etiketi, renkli anahtar kelimeli açıklama) ve kurdeledeki başlık
  oyunda canvas ile çizilir, yani yeni kart eklemek için sadece bir resim ve metin yeter.
- Her seferinde alınmamış kartlardan iki tanesi gelir. Görev **CARGO CHOPPER** ve **FIELD ENGINEER**
  olmadan bitirilemeyeceği için **ilk iki teklifte kartlardan biri her zaman bunlardan alınmamış olandır**
  (önce Cargo Chopper, o alındıysa Engineer). Diğer kart rastgeledir.
- **Kartlar:**
  - **FIELD ENGINEER (Lojistik):** kargo helikopteri mühendisi forkliftiyle birlikte halatla tahtaya
    indirir. O andan itibaren kargo kutuları korunur, forklift onları iskeleye dizer, görev paneli açılır.
  - **CARGO CHOPPER (Lojistik):** mühendisi getiren Chinook bu kart olmadan **paket toplamaya gelmez**.
    Kartla birlikte her 2 dakikada bir gelip iskeledeki paketleri götürür; geri sayım, mühendis de
    sahadaysa görünür.
  - **DOUBLE ROW (Lojistik, mühendisten sonra):** iskeleye ikinci bir şerit eklenir, kapasite iki katına
    çıkar (13 → 26). İskele dolunca forklift yeni paket koyamaz, helikopteri bekler. Yeni şeritteki bloklar
    temizlenir, oradaki kargo kutuları doğrudan pakete dönüşür.
  - **GEM MINE (Güç):** kırılan bloklardan elmas çıkmaya başlar (%14; destek bloklarından da). Kart,
    dört elmasın ne yaptığını da anlatır. Bu kart olmadan elmas hiç düşmez.
  - **HOMING ROCKETS (Güç):** **R** desteğini açar; bu kart alınana kadar destek bloklarından R çıkmaz.
    Kart seçilince ilk R hemen yanına düşer.
  - **FLICKER (Savunma):** her hasardan sonraki yanıp sönme (dokunulmazlık) süresi **2 katına** çıkar:
    normal vuruşta 0,25 → 0,5 sn, trene çarpınca 1,5 → 3 sn, yeniden doğunca 2,5 → 5 sn. Yanıp sönerken
    hasar almazsın.
  - **RUSH DELIVERY (Lojistik, Cargo Chopper'dan sonra):** kargo helikopteri **%30 daha sık** gelir:
    2:00 yerine 1:24. O anda işleyen geri sayım da %30 kısalır.
  - **SURPRISE EGG (Destek):** bu kart alınana kadar tahtada hiç dikenli top yoktur. Kart alındıktan
    sonra tahtada kırılacak blok kalmayınca gökyüzünden **3 dikenli top** düşer, sekip
    diğerleri gibi yuvarlanmaya başlar. Her biri patlatılınca **%20** ihtimalle bir destek düşürür; tren
    gelip blok bırakana kadar mühimmat kaynağıdır. Toplar bitince ve tahta hâlâ boşsa yeni üçlü gelir.
- Kartlar `src/ui/UpgradeCards.js` → `CARD_DEFS` listesinde; resimler `assets/textures/cards/`.
  Ayarlar: `GameConfig.cards`. Doğrulama: `node tools/cardtest.mjs`.

### Ekran göstergeleri (HUD)

- **Sol alt, alttan yukarı:**
  - En üstte **günlük akışı** (terminal / kill feed gibi): ekranın ortasında çıkan duyurular okunduktan
    sonra küçülüp buraya uçar ve satır olarak bir süre kalır. Olaylar Counter-Strike'taki gibi
    "KİM ➜ NE" yazılır: `HELI ➜ TURRET +100`, `ENGINEER ➜ RED PACKAGE → dock`,
    `HELI ➜ BLUE GEM · RAPID FIRE`, `ARMORED TRAIN ➜ HELI ☠`... En fazla 6 satır, her biri ~9 sn
    sonra kayarak kaybolur.
  - Helikopterin canı (100 can, 5'erlik 20 parça). %25'in altında kırmızı yanıp söner ve helikopterden
    ince kara duman çıkar.
  - Üstünde **kargo helikopteri geri sayımı** (2:00'dan geriye). Son 10 saniyede büyüyüp yanıp söner,
    sarı onluk sayaca geçer; helikopter gelince yükleme sayacına döner.
  - En üstte **görev paneli**: teslim edilen kırmızı / yeşil / mavi paketler (x/100) ve iskeledeki paket sayısı.
- **Üst orta: zırhlı tren paneli.** Soldan sağa vagon vagon kartlar; her kartta o vagonun parçaları (elmas,
  taretler, renkli kargo küpleri) dikey çubuk olarak durur. Hasar aldıkça azalır, yok olunca boş kalır,
  tamamen biten vagonun üstü çizilir. Sağda tur, hız modu, **🛡 KALKAN** durumu ve toplam yüzde görünür.
- Her hasarda ekranın kenarında Blocked'daki gibi kırmızı bir hale belirir ve 2 saniyede söner.

### Zırhlı tren

- **Her dalgada tren bir vagon uzar:** 1. dalga 6 vagon, 2. dalga 7, 3. dalga 8... en fazla 14 vagon
  (`GameConfig.train.growEvery / maxWagons`). Üstteki tren paneli uzun trenlerde iki satıra geçer.
- A ile B arasında mal taşır gibi her turda yön değiştirir. Her tur rastgele **HIZLI** (hiç durmaz),
  **NORMAL** veya **YAVAŞ** gider. Normal ve yavaş turlarda tahtanın üstünde **3 sn durabilir**;
  dururken taretler 2,5 kat hızlı ateş eder.
- **Taretler** helikopteri izler. Her atışta **iki namlunun ikisi de** birer gri mermi atar: Blender'da
  modellenen, namlu kalınlığında gri mermiler, namlunun baktığı yönde gider. Taret hızlı dönen helikopterin
  gerisinde kalırsa mermi de geride kalır. Namlular her atışta geri teper.
- **Taretler kırılabilir:** hasar aldıkça önce duman, sonra kıvılcım çıkarırlar. Canı bitince patlarlar:
  taret kafası namlularıyla birlikte koparak uçar, yere çarpıp seker ve yanarak kaybolur. Etrafa koyu metal
  parçalar saçılır, yerinde yanan bir kütük kalır.
- **Sarı pirinç toplar** (trenin altından çıkan sarı borular) helikoptere nişan almaz. Rastgele bir top,
  **kendi namlusunun yönünde** yuvarlak bir demir gülle fırlatır: hafif bir yay çizer ve arkasında duman
  bırakır, isabet ederse 10 hasar verir.
- **Lokomotifin başı en güçlü yerdir:** taretlerden biri bile ayaktayken elmasın önünde mavi bir enerji
  kalkanı vardır ve hasarın sadece %5'i geçer. **Son taret de kırılınca kalkan parçalanır**
  ("GEM SHIELD DOWN") ve elmas tam hasar alır.
- Trene çarpmak **25 can** götürür: helikopter geri savrulur ve 1,5 sn yanıp söner.
- Aynı tren, lokomotifteki elmas yok edilene (%0) kadar tekrar tekrar gelir. Yok ettiğin taretler ve
  elmasa verdiğin hasar kalıcıdır; kargo vagonları her turda yeni küplerle dolu gelir. Yok edilen tren
  yanarak hızlanır ve birkaç saniyede sahneyi terk eder, sonraki dalgada yeni tren gelir.
- Geçerken rayın sağındaki iki sütunda boşalan karelere vagonlardan yeni blok bırakır.

### Lojistik: mühendis, forklift, iskele ve kargo helikopteri

- **Trenden düşen kutular:** vagondan vurulan küp rayın **solunda**, forkliftin ulaşabileceği en yakın
  boş kareye düşer. Kırmızı, yeşil ve mavi küpler **kargo** olur: üzerlerinde koli bandı, barkodlu etiket
  ve "bu taraf yukarı" okları vardır. Sarılar sıradan blok olarak kalır.
- **Mühendis:** kasketli, üniformalı, çizmeli bir asker sarı bir forklift kullanır (ikisi de Blender'da
  modellendi). **FIELD ENGINEER** kartı seçilene kadar sahada yoktur; o zamana kadar trenden düşen
  kutular sıradan blok olur. Karolar arasında yol bularak (BFS) en yakın kargoya gider, çatallarını altına sokup kaldırır
  ve kutuyu **en soldaki sütuna (iskele)** taşır. Çalışırken turuncu tepe lambası yanıp söner.
  Önü bloklarla kapanırsa bekler; bloğu vurarak yolunu açabilirsin. Görevi bilir: bir rengin
  teslim edilen + iskelede bekleyen + çatalındaki paket sayısı 20'ye ulaşınca o rengi toplamaz;
  o renkteki kargo sıradan (vurulabilir) bloğa döner, trenden düşenler de kargo olmaz.
- **Hediye paketleri:** iskeleye bırakılan kutu, **altın kurdeleli ve fiyonklu bir hediye paketine**
  dönüşür. Paketler **vurulamaz**: mermiler içlerinden geçer. Hafifçe ışıldar ve alınmayı bekler. İskele
  sarı-siyah şeritle boyalıdır; paketler üst üste konmaz, sıra dolunca forklift bekler (13 yer,
  **DOUBLE ROW** kartıyla 26).
- **CH-47F Chinook kargo helikopteri** (Blender'da, fotoğraftaki sarı / yeşil / koyu kamuflajla):
  **CARGO CHOPPER** kartıyla **her 2 dakikada bir** gelir. Soldan yaklaşır, iskele sütununun üstünde kameraya doğru döner ve paketleri
  sırayla (uzaktan yakına, üstteki önce) **vinç ile karnına çeker**. Yükleme bitince sola ve yukarı uçup
  gider. Pervane rüzgârı yerdeki karı savurur. Her paket görev sayacına eklenir (+100 puan).
- Ayarlar: `GameConfig.logistics` (`chinookInterval`, `goal`, `forkliftSpeed`, `dockCol`).
  Doğrulama: `node tools/logisticstest.mjs`.

### Bloklar

3 tip vardır: normal, **zırhlı** (çelik kafesli, ~3 kat dayanıklı) ve **destek bloğu** (her yeni blok
için %20 şans; zırhlı %20, kalanı normal). Bir blok patlayınca ona **değen aynı renkteki bloklar zincirleme**
patlar (her halka daha çok puan getirir). Tahtadaki bloklar kendiliğinden geri gelmez: yeni bloklar sadece
trenden gelir. En soldaki sütun iskeledir, orada blok olmaz.

## Geliştirme

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/index.html (tek dosya)
```

URL parametreleri:

| Parametre | Açıklama |
|---|---|
| `?quality=high\|medium\|low` | Görüntü kalitesi (telefonda otomatik `medium`) |
| `?poster&logo` | Tanıtım görselindeki kareyi sabit olarak çizer (karşılaştırma için) |
| `?cam=x,y,z,pitch,yaw,fov,lensK` | Kodu değiştirmeden kamera ayarı dene |
| `?procedural` | Blender helikopteri yerine eski kodla üretilen modeli kullan |

## Görsel teknikler

- **Kamera ve mercek:** tanıtım görseline `tools/overlay.mjs` ile oturtuldu (geniş açı, soldan, sağa dönük).
  Üstüne hafif bir fıçı mercek bükmesi (`LensPass`) eklendi; görseldeki "diorama" hissi buradan gelir.
- **Arka plan eğimi:** gökyüzü ve adalar ayrı bir grupta, kameraya doğru 17° eğik durur. Böylece tahta
  dik açıdan görünürken adaların kayalık yüzleri, şelaleler ve ufuk aynı karede görünür (görseldeki
  perspektif hilesi).
- **Zemin:** mermer fotoğrafından kalebodur karolar (`TileFloorMaterial.js`). Blok ızgarasıyla hizalı
  1,5 birimlik kareler; her karoda fotoğrafın farklı bir bölümü, 90°'lik rastgele dönüş, derz ve pah var.
- **Karolarda kar:** kar yağarken taneler tek tek karolara konar, yamalar halinde birikir; yağış azalınca
  erir (sıcak noktalarda daha hızlı, bu yüzden parça parça). Helikopterin pervane rüzgârı altındaki karı
  daire şeklinde savurur, forkliftin tekerlekleri iz bırakır, Chinook geniş bir alanı temizler. Kar
  örtüsü işlemcide düşük çözünürlüklü bir ızgarada hesaplanır ve karo shader'ında ince taneli bir serpinti
  olarak çizilir (`FloorSnow`, `src/world/Snow.js`).
- **Raylarda kar:** dalgalar halinde gelip giden hafif kar yağışı. Raylarda her travers aralığı rastgele
  bir miktara kadar birikir. Tren geçerken kar erir ve savrulur, 2-9 sn sonra yeniden dolar. Ara sıra
  5-12 sn süren tipiler gelir.
- **Küpler:** yuvarlatılmış köşeli küpler (instanced), Voronoi çatlaklı normal map, yumuşak kar yığınları.
- **Araçlar:** tren `VoxelModelBuilder` ile kenarları pahlı kutulardan kurulur; `VoxelMaterial` her
  yüzeye mikro-voksel desen ve derz basar.
- **Mermiler:** taret mermisi, roket, forklift ve Chinook Blender'da modellendi; demir gülleler kendi
  ekseninde döner. Hepsi hız yönüne göre dönen instanced mesh olarak çizilir.
- **Efektler:** plazma kuyrukları, iz mermileri, ateş topları, kırılan küp parçaları, baca dumanı,
  kopan taret enkazı, kalkan kıvılcımları.
- **Görüntü sonrası işlem:** MSAA + HDR → ön plan bulanıklığı (çam ağaçları) → parlama (bloom) →
  renk ayarı → mercek → ACES ton eşleme.
- **Logo:** `src/ui/VoxelLogo.js` canvas üzerinde voksel harfler çizer (tank figürlü A dahil).

## Blender modelleri

| Model | Betik | Çıktı |
|---|---|---|
| Helikopter | `tools/blender/build_heli.py` | `assets/models/helicopter.glb / .blend` |
| Güdümlü roket | `tools/blender/build_rocket.py` | `assets/models/rocket.glb / .blend` |
| Taret mermisi, forklift + mühendis asker, CH-47F Chinook | `tools/blender/build_props.py` | `assets/models/bullet.glb`, `forklift.glb`, `chinook.glb` (+ `.blend`) |
| Geliştirme kartı | `tools/blender/build_card.py` | `assets/models/card.glb / .blend` |
| BLOCK HAULER treni | `tools/blender/build_hauler.py` | `assets/models/hauler.glb / .blend` |
| T / D plazma mermileri | `tools/blender/build_plasma.py` | `assets/models/plasma.glb / .blend` (PlasmaBolt, NovaBolt) |

Oyun `.glb` dosyalarını yükler; yüklenemezse basit yedek modellere döner. Ayrıntılar: `tools/blender/README.md`.

## Klasörler

```
src/core       Game (ana döngü), RenderPipeline, Input, görüntü sonrası işlem geçişleri
src/world      Tahta, ray, adalar, çamlar, bulutlar, gökyüzü, kar (World cephesi)
src/entities   Helikopter, tren, blok alanı, dikenli toplar, destekler, lojistik (forklift, iskele, Chinook)
src/fx         Partikül, mermi, enkaz, billboard toplu çizimi
src/textures   Prosedürel doku ve malzeme kütüphanesi, karo zemin shader'ı
src/ui         HUD ve voksel logo
src/config     GameConfig (yerleşim, kamera, oyun ayarları), Palette (tüm renkler)
tools          ekran görüntüsü, kamera eşleme, oyun testleri, Blender betikleri
```

Renkler `src/config/Palette.js`'te, kamera, tahta yerleşimi ve oyun ayarları `src/config/GameConfig.js`'te,
başlangıç küp haritası `src/entities/BlockField.js` içindeki `MAP` dizisinde.

## Test araçları (görünmez Chromium)

```bash
node tools/screenshot.mjs captures/out.png 1672 941 "&logo"   # poster karesi
node tools/overlay.mjs -8.6,11.7,13.8,42,19,60,0.18 out.png    # yerleşimi tanıtım görselinin üstüne çiz
node tools/playtest.mjs                                        # genel oynanış testi
node tools/traintest.mjs                                       # akıllı nişan, çarpışma, tren turları, duruşlar
node tools/weapontest.mjs                                      # çift taret mermisi, toplar, kırılan taretler, kalkan
node tools/logisticstest.mjs                                   # forklift, iskele, Chinook, geri sayım, görev sonu
node tools/snowtest.mjs                                        # karolarda kar birikmesi ve erimesi
node tools/cardtest.mjs                                        # kart teklifleri, mühendis, çift sıra, roket, sürpriz yumurta
node tools/gemtest.mjs                                         # elmas etkileri: hızlı ateş, asit, güçlü atış, kritik
node tools/cardviewtest.mjs                                    # kart netliği, inceleme modu, günlük akışı
node tools/wavetest.mjs                                        # kartsız top yok, dalga başına bir vagon
node tools/verify-dist.mjs                                     # dist dosyasını file:// ile aç
```

## Tanıtım görseliyle bilinen farklar

Tanıtım görseli yapay zekâyla üretilmiş bir illüstrasyon; perspektifi fiziksel olarak tutarlı değil
(sol duvar, uzak duvar ve ray tek bir kamerayla aynı anda o açılarda görünemiyor). Kamera bu yüzden en
yakın tutarlı çözüme oturtuldu. Elle boyanmış detay seviyesi (kayalardaki fırça dokusu, her çamın ayrı
çizimi) gerçek zamanlı çizimde birebir değil; yerleşim, açı, renkler ve nesnelerin tasarımı aynı.

## MonoGame sürümü (Desktop + Android)

`MonoGame/` klasöründe aynı oyunun MonoGame portu var: Shared projede yönetilen içerik, DesktopGL ve
Android (yatay, sanal joystick + dönüş butonları). İçerik bu web sahnesinden
`node tools/export-monogame.mjs` ile üretilir. Ayrıntılar: [MonoGame/README.md](MonoGame/README.md).
