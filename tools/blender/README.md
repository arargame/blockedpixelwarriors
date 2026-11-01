# Helikopter modeli (Blender)

`build_heli.py` helikopteri Blender içinde voxel bloklardan kurar, malzemeleri ve silah
noktalarını (`HP_*` boş objeleri) ekler, sonra şunları üretir:

- `assets/models/helicopter.blend`: Blender'da açıp düzenleyebileceğin dosya
- `assets/models/helicopter.glb`: oyunun yüklediği model (build sırasında `dist/index.html` içine gömülür)

## Kendi Blender'ında açmak (Steam)

1. Blender'ı aç, **File > Open** ile `assets/models/helicopter.blend` dosyasını seç.
2. Elle düzenlemek istersen: parçaları değiştir, sonra **File > Export > glTF 2.0 (.glb)**,
   dosya adı `assets/models/helicopter.glb`, Format: *glTF Binary*, *Apply Modifiers* açık.
   Obje adlarını (`HeliBody`, `HeliRotor`, `HeliTailRotor`, `HP_*`) ve malzeme adlarını
   (`HeliGreen`, `Gunmetal`...) koru; oyun bunları adla buluyor.
3. Ya da kodla yeniden üret: **Scripting** sekmesi > **Open** > `tools/blender/build_heli.py` > **Run Script**.
4. Oyuna yansıması için proje klasöründe `npm run build`.

## Komut satırından (Blender kurulu olmadan da çalışır: `pip install bpy`)

```bash
python tools/blender/build_heli.py --render captures/heli.png --samples 96          # key art açısı
python tools/blender/build_heli.py --render captures/heli_side.png --view side
```

Renkler dosyanın başındaki `PALETTE` sözlüğünde. Oyundaki boya tonları ışığa göre ayrıca
`src/entities/HelicopterGltf.js` içindeki `GAME_PAINT` ile ayarlanıyor.

# Taret mermisi, forklift + mühendis ve CH-47F Chinook

`build_props.py` üç modeli üretir (her biri `.glb` + `.blend`):

- `bullet`: taretlerin namlu kalınlığında gri mermi (oyunda tren ölçeğiyle ×1,6 büyütülür)
- `forklift`: sarı forklift ve üstünde kasketli, üniformalı, çizmeli mühendis asker.
  Obje adları: `Forklift` (gövde), `Forks` (oyunun yukarı aşağı oynattığı çatal), `Soldier`
- `chinook`: CH-47F tandem rotorlu kargo helikopteri; sarı, yeşil ve koyu kamuflaj.
  Obje adları: `Chinook` (gövde), `RotorFront`, `RotorRear` (oyun bunları döndürür)

```bash
python tools/blender/build_props.py                        # üçünü de üret
python tools/blender/build_props.py --only chinook --render captures   # tek model + Cycles önizleme
```

Blender içinden: **Scripting** > **Open** > `tools/blender/build_props.py` > **Run Script** (üçünü de kurar).
Oyuna yansıması için `npm run build`.

# Geliştirme kartı

`build_card.py` poker kartı inceliğinde (0,63 × 0,88 × 0,003) bir kart üretir: yuvarlak köşeler,
kabartma altın çift çerçeve, köşe elmasları, tepede taş ve kenarlardan taşıp arkaya kıvrılan 3D kurdele.
Malzeme adları oyunda kullanılır: `CardFront` (yüz: resim + açıklama), `CardBack`, `CardEdge`, `CardGold`,
`CardJewel` (karta göre renklenir), `CardBanner` (başlık yazısı), `CardTail`.

```bash
python tools/blender/build_card.py                                                        # card.glb + card.blend
python tools/blender/build_card.py --render captures --art assets/textures/cards/engineer.jpg   # sadece önizleme
```

# BLOCK HAULER treni (2. bölüm)

`build_hauler.py` key art'taki "BLOCK HAULER" trenini kurar: kar küreği (kar savar), ızgaranın
iki yanında dört yuvarlak far, ortada parlayan ocak gözü (zayıf nokta, kalkanla korunur), sarı-siyah
tehlike şeritleri, yanlarda paslı dişliler, iki baca ve öndeki sarı kancalı kollar; küplerle dolu
kırmızı vagon, zincirinde gülle sallayan sarı vinç vagonu, buz bloklu gümüş kafes vagon ve cevher vagonu.

Kök objeler (her biri bir vagon, oyun yeniden yerleştirir): `HaulerLoco`, `HaulerHopper`, `HaulerCrane`,
`HaulerCage`, `HaulerOre`. Oyunun kullandığı alt objeler: `Core`, `TurretMount`, `Chimney0/1`,
`Headlight0..3`, `CargoDeck`, `CraneSlew` > `CraneTip`, `CraneChain` (birim uzunluk, -Y), `WreckingBall`.

```bash
python tools/blender/build_hauler.py                       # hauler.glb + hauler.blend
python tools/blender/build_hauler.py --render captures     # + Cycles önizleme (ön ve yan)
```

# Plazma mermileri (T ve D güçlendirmeleri)

`build_plasma.py` iki enerji mermisi kurar ve `assets/models/plasma.glb` olarak dışa aktarır:

- **PlasmaBolt** (T - üçlü ateş): fasetli macenta kristal baş, içinde beyaz sıcak çekirdek, başın
  çevresinde iki camgöbeği enerji halkası, mavi konik kuyruk ve ona sarılan üç burgulu kanat.
- **NovaBolt** (D - 8 yöne ateş): aynı mermi buz mavisi / beyaz tonlarda.

Mermiler Blender'da +Y yönüne bakar (oyunda -Z ileri), tüm malzemeler ışık saçar (bloom parlatır).
Oyun mermiyi uçuş ekseni etrafında döndürür; kanatlar ve halkalar üstten bakınca da 3D okunur.

```bash
python tools/blender/build_plasma.py                         # plasma.glb + plasma.blend
python tools/blender/build_plasma.py --render captures/p.png  # + önizleme
```

# CRT haberleşme cihazı (2. bölüm)

`build_crt.py`, Blocked Pixel Panzer'in CRT supply turntable atlasından (`ref/crt_atlas.png`, 16 açı)
3D telsizi kurar: eskimiş zeytin yeşili gövde (yan profili önden eğimli), kenarlarda vida olan haki
ön çerçeve, koyu lastik çerçeve içinde **bombeli tüp ekran** (tarama çizgili, parlayan piksel "CRT"),
altta yeşil LED, iki düğme ve turuncu-siyah tehlike şeritleri, yanlarda iki turuncu yarık lamba ve
havalandırma paneli, arkada kablo oluğu, üstte taşıma kolu, cıvatalı braket ve kırmızı uçlu çanak
anten, sol yanda kırmızı / mavi / turuncu kablolar. Dokular (eskimiş boya, ekran, şerit) betikte
numpy / PIL ile boyanır ve `.glb` içine gömülür.

```bash
python tools/blender/build_crt.py                          # crt.glb + crt.blend
python tools/blender/build_crt.py --views captures/crt     # + atlasla aynı 16 açıdan render
```

# Oyuncu tankı (tank seviyesi)

`build_tank.py`, tankı Meshy konseptinin 10 açısına (`ref/tank/meshy_01..10.png`) bakarak parça parça
kurar: büyük yuvarlak uçlu paletler (iki pedli bağlantılar), koyu zemin üzerinde kademeli bölünmüş
etek panelleri ve menteşe, palet üstünde dört büyük karo ve arada turuncu yarık, arkada çift kırmızı
lamba, ön plakada yarık + turuncu lambalar, kama profilli taret (yanlarda büyük + küçük sekizgen disk,
eğik turuncu şerit, arka köşelerde üst üste sarı lambalar, mavi lens), kare kesitli uzun namlu ve
delikli kare namlu ağzı. Piksel kamuflaj + her pahta açık yeşil kenar vurgusu.

Hiyerarşi: `Tank` (kök) → `TankHull`, `TankLink` (tek palet bağlantısı; oyun iki halka boyunca
çoğaltıp döndürür, döngü ölçüleri kökün `extras.track` alanında), `TankTurret` → `TankBarrel` →
`TankMuzzle`. Yanıp sönen lambaların kendi malzemeleri var: `TankRed`, `TankAmber`.

```bash
python tools/blender/build_tank.py                         # tank.glb + tank.blend
python tools/blender/build_tank.py --render captures/tank  # + Meshy'nin 10 açısından render
python tools/blender/build_tank.py --card captures/card.png # menü kartı resmi
```

# Avcı uçak (tank seviyesi düşmanı)

`build_fighter.py`, Blocked Pixel Panzer'deki FighterJet düşmanını (`Blocked.Shared/Content/Enemies/
FighterJetTextureAtlasV2.png`, kareler `ref/fighter/`) 3B yapar: süperelips halkalardan loft edilmiş
tombul gövde (zeytin yeşili, panel çizgileri, perçinler, iki yanda kırmızı yıldızlı rozet, burunda
kırmızı köpekbalığı ağzı + beyaz dişler + göz), koyu kaporta dudağı, radyal silindirler, her yanda 3
egzoz; hafif dihedralli eliptik uçlu alçak kanatlar (üst / alt rozet), kanat altında 3 namlulu
silah paketi ve gövdedeki cephane kutusundan sarkan pirinç mermi şeridi; yuvarlak dikey ve yatay
kuyruk; 3 çerçeveli cam kubbe, açık arka kokpitte deri kasklı, gözlüklü, atkılı pilot. Pervane
(zeytin göbek, uçları turuncu 3 pas rengi kanat) ve sprite'taki altın halkalı bulanık disk ayrı
nesneler (oyun döndürür); karın kancasındaki 500 lb WW2 bombası (ogive burun, tapa, sarı bantlar,
kutu kuyruk) ayrı nesne — oyun kopyasını bırakır. Dokular PIL ile üretilip .glb'ye gömülür.

Hiyerarşi (three.js eksenleri, burun = +Z): `Fighter` → `FighterBody`, `FighterProp` (+Z etrafında
döner), `FighterPropDisc`, `FighterBomb`, `FighterGunL/R` (namlu ucu boşlukları).

```bash
python tools/blender/build_fighter.py                       # fighter.glb + fighter.blend
python tools/blender/build_fighter.py --render captures/fx  # + sprite açısı, yan, üst, ön, alt, oyun
```

