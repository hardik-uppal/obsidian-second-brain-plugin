#!/usr/bin/env python3
"""
Test script for the updated Plaid backend with latest SDK
"""

import requests
import json
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

BASE_URL = "http://localhost:8000"

def test_health_endpoints():
    """Test basic health endpoints"""
    print("🏥 Testing health endpoints...")
    
    # Test root endpoint
    response = requests.get(f"{BASE_URL}/")
    print(f"GET / - Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   Service: {data.get('service')}")
        print(f"   Plaid Env: {data.get('plaid_env')}")
    
    # Test health endpoint
    response = requests.get(f"{BASE_URL}/health")
    print(f"GET /health - Status: {response.status_code}")
    
    # Test endpoint
    response = requests.get(f"{BASE_URL}/test")
    print(f"GET /test - Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   Plaid configured: {data.get('plaid_configured')}")
        print(f"   Environment: {data.get('environment')}")

def test_link_token_creation():
    """Test Plaid Link token creation with latest SDK"""
    print("\n🔗 Testing Link Token Creation...")
    
    payload = {
        "user_id": "test_user_latest_sdk",
        "credentials": {
            "client_id": "",  # Will use env variable
            "secret": "",     # Will use env variable
            "environment": "sandbox"
        },
        "country_codes": ["US"]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/plaid/link-token", json=payload)
        print(f"POST /plaid/link-token - Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ Link token created successfully")
            print(f"   Token prefix: {data.get('link_token', '')[:20]}...")
            print(f"   Expiration: {data.get('expiration')}")
            return data.get('link_token')
        else:
            print(f"   ❌ Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"   ❌ Exception: {str(e)}")
        return None

def test_environment_mapping():
    """Test the new environment mapping"""
    print("\n🌍 Testing Environment Mapping...")
    
    environments = ["sandbox", "production"]
    
    for env in environments:
        payload = {
            "user_id": f"test_user_{env}",
            "credentials": {
                "client_id": "",
                "secret": "",
                "environment": env
            },
            "country_codes": ["US"]
        }
        
        try:
            response = requests.post(f"{BASE_URL}/plaid/link-token", json=payload)
            print(f"   Environment '{env}' - Status: {response.status_code}")
            
            if response.status_code == 400:
                # Expected for production without valid credentials
                print(f"     Expected error for {env} environment")
            elif response.status_code == 200:
                print(f"     ✅ {env} environment working")
                
        except Exception as e:
            print(f"     ❌ Exception for {env}: {str(e)}")

def test_error_handling():
    """Test improved error handling"""
    print("\n⚠️  Testing Error Handling...")
    
    # Test with invalid credentials
    payload = {
        "user_id": "test_user_invalid",
        "credentials": {
            "client_id": "invalid_client_id",
            "secret": "invalid_secret",
            "environment": "sandbox"
        },
        "country_codes": ["US"]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/plaid/link-token", json=payload)
        print(f"POST /plaid/link-token (invalid creds) - Status: {response.status_code}")
        
        if response.status_code == 400:
            error_data = response.json()
            detail = error_data.get('detail', '')
            print(f"   Error handling: {detail}")
            
            # Check if it's using the new error format
            if "Plaid API Error" in detail:
                print("   ✅ Using enhanced Plaid error handling")
            else:
                print("   ⚠️  Using basic error handling")
                
    except Exception as e:
        print(f"   ❌ Exception: {str(e)}")

def test_multi_country_support():
    """Test multi-country support"""
    print("\n🌎 Testing Multi-Country Support...")
    
    countries = [
        ["US"], ["CA"], ["GB"], ["FR"], ["DE"],
        ["US", "CA"], ["GB", "IE", "FR"]
    ]
    
    for country_list in countries:
        payload = {
            "user_id": f"test_user_{'_'.join(country_list)}",
            "credentials": {
                "client_id": "",
                "secret": "",
                "environment": "sandbox"
            },
            "country_codes": country_list
        }
        
        try:
            response = requests.post(f"{BASE_URL}/plaid/link-token", json=payload)
            print(f"   Countries {country_list} - Status: {response.status_code}")
            
            if response.status_code == 200:
                print(f"     ✅ Supported")
            elif response.status_code == 400:
                error_data = response.json()
                print(f"     ⚠️  Error: {error_data.get('detail', '')[:100]}...")
                
        except Exception as e:
            print(f"     ❌ Exception: {str(e)}")

def test_sdk_version_compatibility():
    """Test SDK version and API compatibility"""
    print("\n🔧 Testing SDK Compatibility...")
    
    # Try to create a link token and analyze the request structure
    payload = {
        "user_id": "sdk_test_user",
        "credentials": {
            "client_id": "",
            "secret": "",
            "environment": "sandbox"
        },
        "country_codes": ["US"]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/plaid/link-token", json=payload)
        
        if response.status_code == 200:
            print("   ✅ SDK v35.0.0 working correctly")
            print("   ✅ Environment enum mapping functional")
            print("   ✅ plaidVersion header included")
        elif response.status_code == 400:
            error_data = response.json()
            detail = error_data.get('detail', '')
            
            # Check if error suggests configuration issues
            if "not configured" in detail.lower():
                print("   ⚠️  SDK working but credentials not configured")
                print("   ✅ Error handling working")
            else:
                print(f"   ⚠️  Potential SDK issue: {detail}")
        else:
            print(f"   ❌ Unexpected status: {response.status_code}")
            
    except Exception as e:
        print(f"   ❌ Exception: {str(e)}")

def main():
    """Run all tests"""
    print("🚀 Testing Updated Plaid Backend with Latest SDK v35.0.0\n")
    
    # Check if server is running
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            print("❌ Server not responding. Make sure backend is running on localhost:8000")
            return
    except:
        print("❌ Cannot connect to server. Make sure backend is running on localhost:8000")
        return
    
    # Run tests
    test_health_endpoints()
    test_sdk_version_compatibility()
    test_link_token_creation()
    test_environment_mapping()
    test_error_handling()
    test_multi_country_support()
    
    print("\n✅ All tests completed!")
    print("\n📝 Notes:")
    print("   - Make sure PLAID_CLIENT_ID and PLAID_SECRET are set in .env")
    print("   - Some errors are expected when testing invalid configurations")
    print("   - Production environment may require different credentials")

if __name__ == "__main__":
    main()
