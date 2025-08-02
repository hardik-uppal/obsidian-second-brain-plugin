#!/usr/bin/env python3
"""
Test script to validate the FastAPI backend setup.
Run this after setting up the backend to ensure everything works.
"""

import requests
import sys
import json
from typing import Dict, Any

BACKEND_URL = "http://localhost:8000"

def test_health_check() -> bool:
    """Test if the backend server is running."""
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check passed: {data.get('status')}")
            return True
        else:
            print(f"❌ Health check failed: HTTP {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Cannot connect to backend: {e}")
        return False

def test_root_endpoint() -> bool:
    """Test the root endpoint."""
    try:
        response = requests.get(f"{BACKEND_URL}/", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Root endpoint works: {data.get('service')}")
            return True
        else:
            print(f"❌ Root endpoint failed: HTTP {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Root endpoint error: {e}")
        return False

def test_test_endpoint() -> bool:
    """Test the test endpoint."""
    try:
        response = requests.get(f"{BACKEND_URL}/test", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Test endpoint works")
            print(f"   - Plaid configured: {data.get('plaid_configured')}")
            print(f"   - Environment: {data.get('environment')}")
            return True
        else:
            print(f"❌ Test endpoint failed: HTTP {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Test endpoint error: {e}")
        return False

def test_plaid_link_html() -> bool:
    """Test if the Plaid Link HTML page is served correctly."""
    try:
        response = requests.get(f"{BACKEND_URL}/plaid/link?client_id=test&environment=sandbox", timeout=5)
        if response.status_code == 200:
            html_content = response.text
            if "Plaid" in html_content and "Connect Your Bank Account" in html_content:
                print("✅ Plaid Link HTML page served correctly")
                return True
            else:
                print("❌ Plaid Link HTML page missing expected content")
                return False
        else:
            print(f"❌ Plaid Link HTML failed: HTTP {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Plaid Link HTML error: {e}")
        return False

def test_plaid_link_html_with_countries() -> bool:
    """Test if the Plaid Link HTML page supports multiple countries."""
    try:
        # Test with multiple countries
        countries = "US,CA,GB"
        response = requests.get(
            f"{BACKEND_URL}/plaid/link?client_id=test&environment=sandbox&countries={countries}", 
            timeout=5
        )
        if response.status_code == 200:
            html_content = response.text
            if "countrySelect" in html_content and "🇺🇸 United States" in html_content and "🇨🇦 Canada" in html_content:
                print("✅ Plaid Link HTML page supports multiple countries")
                return True
            else:
                print("❌ Plaid Link HTML page missing country selection")
                return False
        else:
            print(f"❌ Plaid Link HTML failed: HTTP {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Plaid Link HTML error: {e}")
        return False

def main():
    """Run all tests."""
    print("🔍 Testing Second Brain FastAPI Backend...")
    print(f"Backend URL: {BACKEND_URL}")
    print()
    
    tests = [
        ("Health Check", test_health_check),
        ("Root Endpoint", test_root_endpoint),
        ("Test Endpoint", test_test_endpoint),
        ("Plaid Link HTML", test_plaid_link_html),
        ("Plaid Link HTML with Countries", test_plaid_link_html_with_countries),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"Running {test_name}...")
        if test_func():
            passed += 1
        print()
    
    print(f"📊 Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Backend is ready for use.")
        print()
        print("Next steps:")
        print("1. Configure your Plaid credentials in the .env file")
        print("2. Test the Plaid integration from Obsidian")
        print("3. Use 'Connect Bank Account' in the plugin settings")
        return 0
    else:
        print("❌ Some tests failed. Please check the backend setup.")
        print()
        print("Troubleshooting:")
        print("1. Make sure the backend server is running (python main.py)")
        print("2. Check that port 8000 is not blocked")
        print("3. Verify your Python dependencies are installed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
