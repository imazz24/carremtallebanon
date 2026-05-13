from fastapi import FastAPI
import requests

app = FastAPI()

# 1. Your local list of Lebanese VINs (Populated by your scraper)
lebanese_vins = ["1HGCM82633A...", "5YJ3E1EA6JF...", "4T1B11AK1JU..."]

@app.get("/list-lebanon-vins")
async def get_dropdown_list():
    """Populates your frontend dropdown box"""
    return lebanese_vins

@app.get("/decode/{vin}")
async def decode_vin(vin: str):
    """Fetches specs when a user selects a VIN"""
    url = f"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json"
    response = requests.get(url).json()
    
    # Extract specific data from the NHTSA response
    results = {item['Variable']: item['Value'] for item in response['Results'] if item['Value']}
    
    return {
        "model": results.get("Model"),
        "type": results.get("Body Class") # This is 'Sedan', 'SUV', etc.
    }