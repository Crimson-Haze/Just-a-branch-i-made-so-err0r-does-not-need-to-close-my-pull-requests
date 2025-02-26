import { GameConstants, InputActions } from "../constants";
import { Emotes, type EmoteDefinition } from "../definitions/emotes";
import { type AmmoDefinition } from "../definitions/items/ammos";
import { type ArmorDefinition } from "../definitions/items/armors";
import { type BackpackDefinition } from "../definitions/items/backpacks";
import { type HealingItemDefinition } from "../definitions/items/healingItems";
import { type PerkDefinition } from "../definitions/items/perks";
import { type ScopeDefinition } from "../definitions/items/scopes";
import { type ThrowableDefinition } from "../definitions/items/throwables";
import { Loots } from "../definitions/loots";
import { MapPings, type MapPingDefinition, type PlayerPing } from "../definitions/mapPings";
import { type DeepMutable, type SDeepMutable } from "../utils/misc";
import { type Vector } from "../utils/vector";
import { createPacket, type InputPacket } from "./packet";

/**
 * {@linkcode InputAction}s requiring no additional parameter
 */
export type SimpleInputActions = Exclude<
    InputActions,
    | InputActions.EquipItem
    | InputActions.DropWeapon
    | InputActions.DropItem
    | InputActions.UseItem
    | InputActions.Emote
    | InputActions.MapPing
    | InputActions.LockSlot
    | InputActions.UnlockSlot
    | InputActions.ToggleSlotLock
>;

export type InputAction =
    | {
        readonly type: InputActions.UseItem
        readonly item: HealingItemDefinition | ScopeDefinition | ThrowableDefinition
    }
    | {
        readonly type: InputActions.DropItem
        readonly item: HealingItemDefinition | ScopeDefinition | ThrowableDefinition | ArmorDefinition | BackpackDefinition | AmmoDefinition | PerkDefinition
    }
    | {
        readonly type: InputActions.EquipItem | InputActions.DropWeapon | InputActions.LockSlot | InputActions.UnlockSlot | InputActions.ToggleSlotLock
        readonly slot: number
    }
    | {
        readonly type: InputActions.Emote
        readonly emote: EmoteDefinition
    }
    | {
        readonly type: InputActions.MapPing
        readonly ping: PlayerPing
        readonly position: Vector
    }
    | { readonly type: SimpleInputActions };

type MobileMixin = {
    readonly isMobile: false
    readonly mobile?: undefined
} | {
    readonly isMobile: true
    readonly mobile: {
        readonly moving: boolean
        readonly angle: number
    }
};

type TurningMixin = {
    readonly turning: false
    readonly rotation?: undefined
} | ({
    readonly turning: true
    readonly rotation: number
} & ({
    readonly isMobile: false
    readonly distanceToMouse: number
} | {
    readonly isMobile: true
    readonly distanceToMouse?: undefined
}));

export type PlayerInputData = {
    readonly movement: {
        readonly up: boolean
        readonly down: boolean
        readonly left: boolean
        readonly right: boolean
    }
    readonly attacking: boolean
    readonly actions: readonly InputAction[]
    readonly pingSeq: number
} & MobileMixin & TurningMixin;

export type WithMobile = PlayerInputData & { readonly isMobile: true };
export type NoMobile = PlayerInputData & { readonly isMobile: false };

export const PlayerInputPacket = createPacket("PlayerInputPacket")<PlayerInputData>({
    serialize(stream, data) {
        const { movement, isMobile, turning } = data;

        stream.writeUint8(data.pingSeq);

        if ((data.pingSeq & 128) === 0) {
            stream.writeBooleanGroup(
                movement.up,
                movement.down,
                movement.left,
                movement.right,
                isMobile,
                data.mobile?.moving,
                turning,
                data.attacking
            );

            if (isMobile) {
                stream.writeRotation2(data.mobile.angle);
            }

            if (turning) {
                stream.writeRotation2(data.rotation);
                if (!isMobile) {
                    stream.writeFloat(data.distanceToMouse, 0, GameConstants.player.maxMouseDist, 2);
                }
            }

            stream.writeArray(data.actions, action => {
                if ("slot" in action) {
                    // slot is 2 bits, InputActions is 4
                    // move the slot info to the MSB and leave
                    // the enum member as the LSB for compatibility
                    // with the other branch
                    stream.writeUint8(action.type + (action.slot << 6));
                } else {
                    stream.writeUint8(action.type);
                }

                switch (action.type) {
                    case InputActions.EquipItem:
                    case InputActions.DropWeapon:
                    case InputActions.LockSlot:
                    case InputActions.UnlockSlot:
                    case InputActions.ToggleSlotLock:
                        // already handled above
                        break;
                    case InputActions.DropItem:
                        Loots.writeToStream(stream, action.item);
                        break;
                    case InputActions.UseItem:
                        Loots.writeToStream(stream, action.item);
                        break;
                    case InputActions.Emote:
                        Emotes.writeToStream(stream, action.emote);
                        break;
                    case InputActions.MapPing:
                        MapPings.writeToStream(stream, action.ping);
                        stream.writePosition(action.position);
                        break;
                }
            }, 1);
        }
    },
    deserialize(stream) {
        const pingSeq = stream.readUint8();

        const data = {
            movement: {
                up: false,
                down: false,
                left: false,
                right: false
            },
            isMobile: false,
            attacking: false,
            turning: false,
            pingSeq: pingSeq & 127,
            actions: []
        } satisfies SDeepMutable<PlayerInputData> as SDeepMutable<PlayerInputData>;

        if ((pingSeq & 128) === 0) {
            const [
                up,
                down,
                left,
                right,
                isMobile,
                moving,
                turning,
                attacking
            ] = stream.readBooleanGroup();

            data.movement.up = up;
            data.movement.down = down;
            data.movement.left = left;
            data.movement.right = right;

            data.isMobile = isMobile;
            data.turning = turning;
            data.attacking = attacking;

            if (isMobile) {
                data.mobile = {
                    moving,
                    angle: stream.readRotation2()
                };
            }

            if (turning) {
                data.rotation = stream.readRotation2();
                if (!isMobile) {
                    (
                        data as DeepMutable<NoMobile & { turning: true }>
                    ).distanceToMouse = stream.readFloat(0, GameConstants.player.maxMouseDist, 2);
                }
            }

            // Actions
            data.actions = stream.readArray(() => {
                const data = stream.readUint8();
                // hiMask = 2 msb, type = 4 lsb
                const [hiMask, type] = [data & 0b1100_0000, (data & 0b0000_1111) as InputActions];

                let slot: number | undefined;
                let item: HealingItemDefinition | ScopeDefinition | ArmorDefinition | AmmoDefinition | BackpackDefinition | PerkDefinition | undefined;
                let emote: EmoteDefinition | undefined;
                let position: Vector | undefined;
                let ping: MapPingDefinition | undefined;

                switch (type) {
                    case InputActions.EquipItem:
                    case InputActions.DropWeapon:
                    case InputActions.LockSlot:
                    case InputActions.UnlockSlot:
                    case InputActions.ToggleSlotLock:
                        slot = hiMask >> 6;
                        break;
                    case InputActions.DropItem:
                        item = Loots.readFromStream<
                            HealingItemDefinition |
                            ScopeDefinition |
                            ArmorDefinition |
                            AmmoDefinition |
                            BackpackDefinition |
                            PerkDefinition
                        >(stream);
                        break;
                    case InputActions.UseItem:
                        item = Loots.readFromStream<HealingItemDefinition | ScopeDefinition>(stream);
                        break;
                    case InputActions.Emote:
                        emote = Emotes.readFromStream(stream);
                        break;
                    case InputActions.MapPing:
                        ping = MapPings.readFromStream(stream);
                        position = stream.readPosition();
                        break;
                }

                return { type, item, slot, emote, ping, position } as InputAction;
            }, 1);
        }

        return data;
    }
});

/**
* Compare two input packets to test if the information needs to be resent
* @param newPacket The new packet to potentially sent
* @param oldPacket The old packet (usually the last sent one) to compare against
*/
export function areDifferent(
    newPacket: InputPacket<PlayerInputData> | PlayerInputData,
    oldPacket: InputPacket<PlayerInputData> | PlayerInputData
): boolean {
    const newData = newPacket instanceof PlayerInputPacket ? newPacket.input : newPacket as PlayerInputData;
    const oldData = oldPacket instanceof PlayerInputPacket ? oldPacket.input : oldPacket as PlayerInputData;

    if (newData.actions.length > 0) return true;

    for (const k in newData.movement) {
        const key = k as keyof PlayerInputData["movement"];
        if (oldData.movement[key] !== newData.movement[key]) return true;
    }

    if (newData.isMobile !== oldData.isMobile) return true;

    if (newData.isMobile) {
        for (const k in newData.mobile) {
            const key = k as keyof WithMobile["mobile"];
            if ((oldData as WithMobile).mobile[key] !== newData.mobile[key]) return true;
        }
    }

    // allow arbitrary unsafe indexing
    for (const key of ["attacking", "turning", "rotation", "distanceToMouse"] as ReadonlyArray<keyof PlayerInputData>) {
        if (oldData[key] !== newData[key]) return true;
    }

    return false;
}
