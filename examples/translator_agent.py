#!/usr/bin/env python3
"""
Demo: Translation Agent (Provider)
Registers on CAP and serves translation requests.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))

from cap import CAPProvider


def main():
    provider = CAPProvider(agent_id="bob", cap_url="http://localhost:4000")

    # Register handler for translation requests
    @provider.on_request("translation")
    def handle_translation(params: dict) -> dict:
        text = params.get("text", "")
        target = params.get("target", "ko")

        # Simulated translation (in production, call an LLM)
        translations = {
            "Hello world": "안녕하세요 세계",
            "How are you?": "잘 지내세요?",
            "Thank you": "감사합니다",
        }

        translated = translations.get(text, f"[{target}] {text}")
        print(f"    Translated: '{text}' → '{translated}'")
        return {"translated": translated, "source_lang": "en", "target_lang": target}

    print("\n=== Translation Agent (Bob) ===")
    print("  Waiting for translation requests...\n")
    provider.serve(poll_interval=2.0)


if __name__ == "__main__":
    main()
