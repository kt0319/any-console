from fastapi import APIRouter

from . import git_diff, git_files, git_history, git_branches

router = APIRouter()
router.include_router(git_branches.router)
router.include_router(git_history.router)
router.include_router(git_diff.router)
router.include_router(git_files.router)
