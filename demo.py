"""
End-to-end POC flow: user message -> intent router -> execution plan -> skill runtime.

Run: python demo.py "create a PRD for project Atlas"
"""
import sys

from intent_router import route
from mock_prd_skill import run as run_generate_prd

# Maps a matched skill name to its runtime function.
# In the real system this dispatch happens through the Skill Runtime component,
# which looks up and invokes the n8n workflow referenced in the skill's registry entry.
SKILL_RUNTIMES = {
    "generate_prd": run_generate_prd,
}


def handle_message(message: str) -> None:
    print(f"User: {message}\n")

    plan = route(message)
    print(f"Execution plan: {plan}\n")

    if plan["status"] == "no_match":
        print("Router found no matching skill. In production this would fall through")
        print("to Level 2 (semantic matching). Not built yet for this POC.")
        return

    if plan["status"] == "ambiguous":
        print(f"Ambiguous match between: {plan['candidates']}. Would ask a clarifying")
        print("question here rather than guess.")
        return

    skill_name = plan["skill"]
    runtime = SKILL_RUNTIMES.get(skill_name)
    if runtime is None:
        print(f"No mock runtime registered yet for skill '{skill_name}'.")
        return

    if plan["requires_approval"]:
        print("[Human approval step would happen here before execution, per M5]\n")

    result = runtime(message)
    print("--- Skill output ---")
    print(result["output_markdown"])


if __name__ == "__main__":
    msg = " ".join(sys.argv[1:]) or "create a PRD for project Atlas"
    handle_message(msg)
