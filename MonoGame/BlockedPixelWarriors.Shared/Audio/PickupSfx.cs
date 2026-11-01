using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Audio;

namespace BlockedPixelWarriors.Audio;

/// <summary>
/// Pickup chime from Blocked Pixel Panzer (Blocked.Shared/Managers/PickupSfx.cs, the diamond /
/// supply sound), synthesised the same way: C5-E5-G5-C6 rising arpeggio, 55 ms per note, sine +
/// 35% octave above, exponential decay, 1 ms attack, normalised to 0.8, 10 ms fade, tanh soft clip.
/// Volume 0.45 x master x effects; pitch in octaves with a small random jitter. Same as the web
/// build's src/audio/PickupSfx.js.
/// </summary>
public static class PickupSfx
{
    private const int Rate = 44100;
    public const float Volume = 0.45f;
    private static SoundEffect _fx;
    private static bool _failed;

    public static void Prewarm()
    {
        if (_fx != null || _failed) return;
        try
        {
            _fx = Build();
        }
        catch (Exception)
        {
            _failed = true; // no audio device: stay silent
        }
    }

    /// <param name="gain">master x effects, 0..1</param>
    /// <param name="pan">-1 left .. 1 right</param>
    /// <param name="pitch">octaves (-1..1)</param>
    public static void Play(float gain, float pan = 0, float pitch = 0)
    {
        if (gain <= 0) return;
        Prewarm();
        if (_fx == null) return;
        var jitter = (Core.Rng.Shared.Next() - 0.5f) * 0.08f;
        try
        {
            _fx.Play(MathHelper.Clamp(Volume * gain, 0, 1), MathHelper.Clamp(pitch + jitter, -1, 1), MathHelper.Clamp(pan, -1, 1));
        }
        catch
        {
            // out of voices: skip
        }
    }

    private static SoundEffect Build()
    {
        float[] notes = { 523.25f, 659.25f, 783.99f, 1046.50f };
        const float noteLen = 0.055f;
        var n = (int)(Rate * noteLen * notes.Length);
        var buf = new float[n];
        for (var k = 0; k < notes.Length; k++)
        {
            var off = (int)(k * noteLen * Rate);
            var len = (int)(noteLen * Rate);
            for (var i = 0; i < len && off + i < n; i++)
            {
                var t = i / (float)Rate;
                var s = MathF.Sin(MathHelper.TwoPi * notes[k] * t) + 0.35f * MathF.Sin(MathHelper.TwoPi * notes[k] * 2f * t);
                buf[off + i] += s * MathF.Exp(-t * 22f) * MathF.Min(1f, t / 0.001f);
            }
        }
        var max = 0f;
        foreach (var v in buf) max = MathF.Max(max, MathF.Abs(v));
        if (max > 1e-6f)
            for (var i = 0; i < n; i++) buf[i] *= 0.8f / max;
        var f = Math.Min(n, (int)(Rate * 0.010f));
        for (var i = 0; i < f; i++) buf[n - f + i] *= 1f - i / (float)(f - 1);
        var bytes = new byte[n * 2];
        for (var i = 0; i < n; i++)
        {
            var v = (short)MathHelper.Clamp(MathF.Tanh(buf[i]) * 32000f, -32768f, 32767f);
            bytes[i * 2] = (byte)(v & 0xFF);
            bytes[i * 2 + 1] = (byte)((v >> 8) & 0xFF);
        }
        return new SoundEffect(bytes, Rate, AudioChannels.Mono);
    }
}
