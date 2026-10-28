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
