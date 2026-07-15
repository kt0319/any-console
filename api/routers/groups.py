"""ワークスペースグループの CRUD エンドポイント。

グループは config.json の __global__.groups に保存される。
ワークスペースへの割り当ては workspace エントリの group_id フィールドで管理する。
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import GLOBAL_CONFIG_KEY, generate_entity_id
from ..config import load_all_config, save_all_config
from ..errors import not_found

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def _load_groups(all_config: dict) -> list[dict]:
    return list(all_config.get(GLOBAL_CONFIG_KEY, {}).get("groups", []))


def _save_groups(groups: list[dict]) -> None:
    all_config = load_all_config()
    global_section = dict(all_config.get(GLOBAL_CONFIG_KEY, {}))
    global_section["groups"] = groups
    all_config[GLOBAL_CONFIG_KEY] = global_section
    save_all_config(all_config)


class GroupRequest(BaseModel):
    name: str


class GroupOrderRequest(BaseModel):
    order: list[str]


@router.put("/group-order")
def update_group_order(body: GroupOrderRequest):
    all_config = load_all_config()
    groups = _load_groups(all_config)
    order_map = {gid: i for i, gid in enumerate(body.order)}
    sorted_groups = sorted(groups, key=lambda g: order_map.get(g["id"], len(groups)))
    _save_groups(sorted_groups)
    logger.info("group order updated count=%d", len(body.order))
    return [g["id"] for g in sorted_groups]


@router.get("/groups")
def list_groups():
    all_config = load_all_config()
    return _load_groups(all_config)


@router.post("/groups")
def create_group(body: GroupRequest):
    name = body.name.strip()
    if not name:
        from ..errors import bad_request
        raise bad_request("Group name is required")
    group_id = generate_entity_id()
    all_config = load_all_config()
    groups = _load_groups(all_config)
    groups.append({"id": group_id, "name": name})
    _save_groups(groups)
    logger.info("group created id=%s name=%s", group_id, name)
    return {"id": group_id, "name": name}


@router.put("/groups/{group_id}")
def update_group(group_id: str, body: GroupRequest):
    name = body.name.strip()
    if not name:
        from ..errors import bad_request
        raise bad_request("Group name is required")
    all_config = load_all_config()
    groups = _load_groups(all_config)
    for group in groups:
        if group["id"] == group_id:
            group["name"] = name
            _save_groups(groups)
            logger.info("group updated id=%s name=%s", group_id, name)
            return {"id": group_id, "name": name}
    raise not_found(f"Group '{group_id}' not found")


@router.delete("/groups/{group_id}")
def delete_group(group_id: str):
    all_config = load_all_config()
    groups = _load_groups(all_config)
    new_groups = [g for g in groups if g["id"] != group_id]
    if len(new_groups) == len(groups):
        raise not_found(f"Group '{group_id}' not found")
    # グループに所属するワークスペースの group_id をクリアする
    for key, entry in all_config.items():
        if key == GLOBAL_CONFIG_KEY or not isinstance(entry, dict):
            continue
        if entry.get("group_id") == group_id:
            entry["group_id"] = None
    global_section = dict(all_config.get(GLOBAL_CONFIG_KEY, {}))
    global_section["groups"] = new_groups
    all_config[GLOBAL_CONFIG_KEY] = global_section
    save_all_config(all_config)
    logger.info("group deleted id=%s", group_id)
    return {"status": "ok"}
