using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// Base class of everything the player shoots at (src/combat/Enemy.js, Template Method): the
/// armored train / Block Hauler, the board and channel blocks, the fighter plane. Subclasses
/// override the hooks: IsAlive (still a valid target), AimPoint (where weapons aim), OnDamaged
/// (feedback for a hit that did not kill), OnDeath (explosion / drops, called once).
/// HarmsPlayer says whether it can hurt the player at all: blocks are targets only (they never
/// damage the heli or the tank), trains and the fighter shoot back.
/// </summary>
public abstract class Enemy
{
    public float Hp = 1, MaxHp = 1;
    public bool Alive = true;
    public bool HarmsPlayer { get; protected set; }
    public string EnemyKind { get; protected set; } = "enemy";

    protected Enemy() { }

    protected Enemy(float hp, bool harmsPlayer, string kind)
    {
        Hp = MaxHp = hp;
        HarmsPlayer = harmsPlayer;
        EnemyKind = kind;
    }

    public virtual bool IsAlive => Alive;

    public virtual Vector3 AimPoint => Vector3.Zero;

    /// <summary>Applies damage; true when this hit killed the enemy.</summary>
    public virtual bool TakeDamage(float amount, Vector3 at)
    {
        if (!IsAlive) return false;
        Hp -= amount;
        if (Hp <= 0)
        {
            Alive = false;
            OnDeath(at);
            return true;
        }
        OnDamaged(amount, at);
        return false;
    }

    protected virtual void OnDamaged(float amount, Vector3 at) { }

    protected virtual void OnDeath(Vector3 at) { }
}
