import { ObjectCategory } from "@common/constants";
import { InternalAnimation, resolveNumericSpecifier, resolveVectorSpecifier, type SyncedParticleDefinition } from "@common/definitions/syncedParticles";
import { type Variation } from "@common/typings";
import { CircleHitbox } from "@common/utils/hitbox";
import { EaseFunctions, Numeric } from "@common/utils/math";
import { type FullData } from "@common/utils/objectsSerializations";
import { random } from "@common/utils/random";
import { Vec, type Vector } from "@common/utils/vector";
import { type Game } from "../game";
import { BaseGameObject } from "./gameObject";

export class SyncedParticle extends BaseGameObject.derive(ObjectCategory.SyncedParticle) {
    override readonly fullAllocBytes = 0;
    override readonly partialAllocBytes = 32; // TODO adjust me
    override readonly hitbox?: CircleHitbox | undefined;

    private readonly _positionAnim: InternalAnimation<Vector>;

    private readonly _alphaAnim?: Omit<InternalAnimation<number>, "easing">;

    scale = 0;
    private readonly _scaleAnim?: InternalAnimation<number>;

    angularVelocity = 0;

    readonly definition: SyncedParticleDefinition;

    readonly _creationDate: number;
    readonly _lifetime: number;
    age = 0;

    private readonly variant?: Variation;

    creatorID?: number;

    constructor(
        game: Game,
        definition: SyncedParticleDefinition,
        position: Vector,
        endPosition?: Vector,
        layer?: number,
        creatorID?: number
    ) {
        super(game, position);
        this._creationDate = game.now;
        this.definition = definition;

        this.layer = layer ?? 0;

        this.creatorID = creatorID;
        if (definition.hasCreatorID && creatorID === undefined) {
            throw new Error("creatorID not specified for SyncedParticle which requires it");
        }

        this._lifetime = resolveNumericSpecifier(definition.lifetime);

        const { alpha, scale, velocity } = definition;

        const easing = EaseFunctions[velocity?.easing ?? "linear"];
        this._positionAnim = {
            start: position,
            end: endPosition ?? Vec.add(position, Vec.scale(resolveVectorSpecifier(velocity), this._lifetime)),
            easing
        };

        this._position = Vec.lerp(this._positionAnim.start, this._positionAnim.end, easing(0));

        if (typeof alpha === "object" && "start" in alpha) {
            this._alphaAnim = {
                start: resolveNumericSpecifier(alpha.start),
                end: resolveNumericSpecifier(alpha.end)
            };
        }

        if (typeof scale === "object" && "start" in scale) {
            const easing = EaseFunctions[scale.easing ?? "linear"];
            this._scaleAnim = {
                start: resolveNumericSpecifier(scale.start),
                end: resolveNumericSpecifier(scale.end),
                easing
            };

            this.scale = Numeric.lerp(this._scaleAnim.start, this._scaleAnim.end, easing(0));
        } else {
            this.scale = resolveNumericSpecifier(scale);
        }

        this.angularVelocity = resolveNumericSpecifier(definition.angularVelocity);

        if (definition.variations !== undefined) {
            this.variant = random(0, definition.variations) as Variation;
        }

        if (definition.hitbox !== undefined) {
            this.hitbox = this.definition.hitbox?.transform(this.position, this.scale);
        }

        this.setPartialDirty();
    }

    override damage(): void { /* can't damage a synced particle */ }

    update(): void {
        const age = this.game.now - this._creationDate;
        if (age > this._lifetime) {
            this.game.removeSyncedParticle(this);
            return;
        }
        const interpFactor = this.age = age / this._lifetime;

        const { start, end, easing } = this._positionAnim;
        this._position = Vec.lerp(start, end, easing(interpFactor));

        if (this._scaleAnim) {
            const { start, end, easing } = this._scaleAnim;
            this.scale = Numeric.lerp(start, end, easing(interpFactor));
        }

        if (this.hitbox instanceof CircleHitbox && this.definition.hitbox !== undefined) {
            this.hitbox.position = this.position;
            this.hitbox.radius = this.definition.hitbox.radius * this.scale;
            this.game.grid.updateObject(this);
        }
    }

    override get data(): FullData<ObjectCategory.SyncedParticle> {
        return {
            definition: this.definition,
            startPosition: this._positionAnim.start,
            endPosition: this._positionAnim.end,
            layer: this.layer,
            age: this.age,
            lifetime: this._lifetime,
            angularVelocity: this.angularVelocity,
            scale: this._scaleAnim
                ? {
                    start: this._scaleAnim.start,
                    end: this._scaleAnim.end
                }
                : undefined,
            alpha: this._alphaAnim
                ? {
                    start: this._alphaAnim.start,
                    end: this._alphaAnim.end
                }
                : undefined,
            variant: this.variant,
            creatorID: this.creatorID
        };
    }
}
