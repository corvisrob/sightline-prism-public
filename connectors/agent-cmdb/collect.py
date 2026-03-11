#!/usr/bin/env python3
"""
On-Premises CMDB Agent Collector

Collects local system information and normalizes it to AssetComputer schema.
Designed to run as a scheduled task on individual machines.

Requirements:
    - Python 3.8+
    - pymongo
    - psutil (for system information)
"""

import os
import platform
import socket
import json
from datetime import datetime
from typing import Dict, Any, List, Optional

try:
    import psutil
except ImportError:
    print("⚠️  psutil not installed. Install with: pip install psutil")
    print("   Using limited system information...")
    psutil = None

try:
    from pymongo import MongoClient
except ImportError:
    print("❌ pymongo not installed. Install with: pip install pymongo")
    exit(1)


def get_system_info() -> Dict[str, Any]:
    """Gather system information from the local machine"""
    
    hostname = socket.gethostname()
    fqdn = socket.getfqdn()
    
    # Basic platform info
    info = {
        "hostname": hostname,
        "fqdn": fqdn,
        "os": platform.system(),
        "os_version": platform.version(),
        "os_release": platform.release(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
    }
    
    # Enhanced info with psutil
    if psutil:
        try:
            # CPU information
            info["cpu_count"] = psutil.cpu_count(logical=True)
            info["cpu_freq"] = psutil.cpu_freq().current if psutil.cpu_freq() else None
            
            # Memory information (in MB)
            mem = psutil.virtual_memory()
            info["memory_total"] = mem.total // (1024 * 1024)
            info["memory_available"] = mem.available // (1024 * 1024)
            
            # Disk information (in GB)
            disk = psutil.disk_usage('/')
            info["storage_total"] = disk.total // (1024 * 1024 * 1024)
            info["storage_used"] = disk.used // (1024 * 1024 * 1024)
            
            # Network interfaces
            info["network_interfaces"] = []
            for iface, addrs in psutil.net_if_addrs().items():
                for addr in addrs:
                    if addr.family == socket.AF_INET:  # IPv4
                        info["network_interfaces"].append({
                            "interface": iface,
                            "ip": addr.address,
                            "netmask": addr.netmask,
                        })
            
            # Boot time
            info["boot_time"] = datetime.fromtimestamp(psutil.boot_time()).isoformat()
            
        except Exception as e:
            print(f"⚠️  Error gathering enhanced system info: {e}")
    
    return info


def transform_to_asset_computer(sys_info: Dict[str, Any], source_id: str = "agent-cmdb") -> Dict[str, Any]:
    """Transform system info to AssetComputer schema"""
    
    # Generate a unique ID (hostname-based)
    asset_id = f"local-{sys_info['hostname'].lower()}"
    
    # Extract network interfaces
    network = []
    if "network_interfaces" in sys_info:
        for iface in sys_info["network_interfaces"]:
            network.append({
                "interface": iface["interface"],
                "ipAddress": iface["ip"],
                "type": "physical",
            })
    
    # Build AssetComputer object
    asset = {
        "id": asset_id,
        "name": sys_info["hostname"],
        "type": "computer",
        "discoveredAt": datetime.utcnow().isoformat() + "Z",
        "source": source_id,
        "schemaVersion": 1,
        "description": f"On-premises {sys_info['os']} system",
        "tags": [
            f"os:{sys_info['os'].lower()}",
            f"arch:{sys_info['architecture']}",
        ],
        
        # Computer-specific fields
        "os": sys_info["os"],
        "osVersion": sys_info.get("os_release", "unknown"),
        "cpu": sys_info.get("cpu_count"),
        "memory": sys_info.get("memory_total"),
        "storage": sys_info.get("storage_total"),
        "network": network,
        "status": "running",
        "hostname": sys_info["hostname"],
        "fqdn": sys_info["fqdn"],
        
        "virtualization": {
            "type": "physical",  # Could detect VM vs physical
        },
        
        # Extended data with additional system info
        "extendedData": {
            "osVersion": sys_info.get("os_version"),
            "processor": sys_info.get("processor"),
            "architecture": sys_info["architecture"],
            "bootTime": sys_info.get("boot_time"),
            "cpuFreq": sys_info.get("cpu_freq"),
            "memoryAvailable": sys_info.get("memory_available"),
            "storageUsed": sys_info.get("storage_used"),
        }
    }
    
    return asset


def create_snapshot(source: str, schema_name: str, version: int, assets: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Create a snapshot document"""
    return {
        "snapshotTime": datetime.utcnow(),
        "schemaName": schema_name,
        "schemaVersion": version,
        "source": source,
        "data": assets,
        "metadata": {
            "totalItems": len(assets),
            "validItems": len(assets),  # Assume valid (validation should happen in TypeScript)
            "invalidItems": 0,
        }
    }


def collect():
    """Main collection function"""
    
    print("🚀 Starting on-prem agent collection...")
    
    # Get MongoDB connection from environment
    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongo_db = os.getenv("MONGODB_DB", "prism")
    source_id = os.getenv("AGENT_SOURCE_ID", "agent-cmdb")
    
    try:
        # Gather system information
        print("📊 Gathering system information...")
        sys_info = get_system_info()
        print(f"   Host: {sys_info['hostname']}")
        print(f"   OS: {sys_info['os']} {sys_info.get('os_release', '')}")
        if psutil:
            print(f"   CPU: {sys_info.get('cpu_count')} cores")
            print(f"   Memory: {sys_info.get('memory_total')} MB")
        
        # Transform to asset
        print("🔄 Transforming to AssetComputer schema...")
        asset = transform_to_asset_computer(sys_info, source_id)
        
        # Create snapshot
        print("📸 Creating snapshot...")
        snapshot = create_snapshot(source_id, "AssetComputer", 1, [asset])
        
        # Connect to MongoDB
        print("💾 Connecting to MongoDB...")
        client = MongoClient(mongo_uri)
        db = client[mongo_db]
        collection = db[f"snapshots_{source_id}"]
        
        # Insert snapshot
        result = collection.insert_one(snapshot)
        
        print(f"✅ Collection complete!")
        print(f"   - Snapshot ID: {result.inserted_id}")
        print(f"   - Asset ID: {asset['id']}")
        print(f"   - Timestamp: {snapshot['snapshotTime']}")
        
        client.close()
        
    except Exception as e:
        print(f"❌ Collection failed: {e}")
        raise


if __name__ == "__main__":
    collect()
