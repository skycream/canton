#!/usr/bin/env python3
"""
Demo: Research Agent (Consumer)
Hires a translation agent via CAP protocol.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))

from cap import CAPClient


def main():
    client = CAPClient(agent_id="alice", cap_url="http://localhost:4000")

    print("\n=== Research Agent (Alice) ===\n")

    # 1. Check wallet
    balance = client.get_balance()
    print(f"  Balance: {balance} CAP coins")

    # 2. Discover translation services
    print("\n  Discovering translation agents...")
    listings = client.discover("translation")
    for l in listings:
        print(f"    - {l.provider}: {l.description} (base price: {l.base_price})")

    if not listings:
        print("    No translation agents found!")
        return

    # 3. Hire the first translator
    provider_id = listings[0].provider
    print(f"\n  Hiring {provider_id} for translation...")

    try:
        result = client.hire(
            provider=provider_id,
            capability="translation",
            params={"text": "Hello world", "target": "ko"},
            max_price=1.0,
            auto_approve=True,
            poll_interval=2.0,
            timeout=30.0,
        )

        print(f"\n  Deal completed!")
        print(f"    Offer price: {result['offer'].price}")
        print(f"    Review: {result.get('review', {}).get('resultHash', 'N/A')}")

    except TimeoutError as e:
        print(f"  Timeout: {e}")
    except Exception as e:
        print(f"  Error: {e}")

    # 4. Check balance after
    balance = client.get_balance()
    print(f"\n  Final balance: {balance} CAP coins")

    # 5. Check provider reputation
    rep = client.get_reputation(provider_id)
    print(f"  {provider_id} reputation: avg {rep.get('avgRating', 'N/A')} ({rep.get('totalDeals', 0)} deals)")

    print("\n  Done.\n")


if __name__ == "__main__":
    main()
