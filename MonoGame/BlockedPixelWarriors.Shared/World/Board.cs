using BlockedPixelWarriors.Core;

namespace BlockedPixelWarriors.World;

/// <summary>The floating play area: playable bounds and floor height queries (Board.js).</summary>
public sealed class Board
{
    public float MinX => GameConfig.Board.MinX;
    public float MaxX => GameConfig.Board.MaxX;
    public float MinZ => GameConfig.Board.MinZ;
    public float MaxZ => GameConfig.Board.MaxZ;

    public bool Contains(float x, float z, float margin = 0) =>
        x >= MinX + margin && x <= MaxX - margin && z >= MinZ + margin && z <= MaxZ - margin;

    /// <summary>Floor height inside the board (0), or null outside (things fall into the sky).</summary>
    public float? GroundHeightAt(float x, float z) => Contains(x, z) ? 0 : null;
}
