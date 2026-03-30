# Defended Asset List (DAL) CSV Format

## Overview

A **Defended Asset List (DAL)** is an inventory of all network systems relevant to a cyber mission. In Converge, the DAL serves as the single source of truth for network assets. Diagrams are visual representations of subsets of the DAL.

You can populate a mission's DAL by importing a CSV file. This page describes the CSV format and how to create one.

## CSV Columns

| Column | Required | Description | Valid Values |
|---|---|---|---|
| `id` | Export only | UUID assigned by Converge | Auto-generated on import if missing; always included on export |
| `label` | **Yes** | Display name shown on the diagram | Free text (e.g., `Core Switch`, `Web Server`) |
| `type` | **Yes** | Category of the asset | See [Asset Types](#asset-types) for all valid values |
| `ip` | No* | IP address (used for smart merge) | IPv4/IPv6 address, or CIDR for Subnets |
| `mac` | No* | MAC address (used for smart merge) | MAC address (e.g., `00:1A:2B:3C:4D:5E`) |
| `hostname` | No* | System hostname (used for smart merge) | Free text |
| `parentId` | No | Label or ID of the parent node | Must match the `label` of a valid parent asset. See [Asset Types](#asset-types) for valid parent relationships. |
| `metadata.*` | No | Arbitrary metadata key-value pairs | Column header format: `metadata.KEY` (see below) |

> **\*** At least one identity field (`ip`, `mac`, or `hostname`) should be provided per row for smart merge to work. When importing multiple DAL files, entries that share the same identity fields will be updated rather than duplicated.
>
> The `id` column is a Converge-generated UUID. It is **optional on import** — Converge assigns one automatically for new entries. It is **always included on export** for traceability and re-import.

### Asset Types

Converge supports the following asset types organized into two categories: **Infrastructure** (network devices that form the hierarchy) and **Endpoints** (systems that live inside subnets).

#### Infrastructure

| Type | Icon | Description | Valid Parents |
|---|---|---|---|
| **Internet Connection** | ☁️ Cloud | An external connection point to the internet. Typically the root of the hierarchy. | *(none — always a root node)* |
| **Firewall** | 🛡️ Shield | A network security device that controls traffic between zones. | Internet Connection, Router, Switch, Firewall |
| **Router** | 🔀 Network | A device that forwards data packets between networks. | Internet Connection, Router, Firewall, Switch |
| **Switch** | 🔀 Network | A network switch used as a connectivity hub. | Router, Firewall |
| **Subnet** | 📦 Container | A logical network segment (e.g., DMZ, Internal). Rendered as a shaded container that holds endpoint devices. | Router, Switch, Firewall |

#### Endpoints

Endpoint devices are placed inside Subnets using `parentId`. Their parent must be a **Subnet**.

| Type | Icon | Description |
|---|---|---|
| **Workstation** | 🖥️ Desktop | An end-user computer. |
| **Server** | 🗄️ Database | A server system. |
| **Operational Technology** | ⚙️ Microchip | Industrial control systems, PLCs, SCADA, etc. |
| **Device** | 💻 Laptop | Generic catch-all for any other individual system. |

#### Hierarchy Example

```
Internet Connection (root)
  └── Firewall
        └── Router
              ├── Switch
              │     ├── Subnet (DMZ)
              │     │     ├── Web Server
              │     │     └── Mail Server
              │     └── Subnet (Internal)
              │           ├── DB Server
              │           └── File Server
              └── Subnet (Management)
                    └── Admin Workstation
```

### Identity Fields & Smart Merge

When importing a CSV, Converge determines whether an entry already exists by matching on the identity fields `ip`, `mac`, and `hostname`. Not all entries will have all three fields — the algorithm handles partial information:

| Scenario | Behavior |
|---|---|
| **Exact match** on all shared identity fields | Auto-merge: existing entry is updated with incoming data |
| **Partial overlap** (e.g., same IP but one row has a MAC the other lacks) | Flagged as a potential duplicate for manual review |
| **Conflict** (e.g., same IP but different hostname) | Flagged as ambiguous for manual review |
| **No identity overlap** | Inserted as a new entry |

This allows operators to import DAL files from different sources — one source may provide IP addresses while another provides MAC addresses and hostnames.

### Manual Merge ("Merge Asset With...")

When the system detects ambiguous overlaps it can't auto-resolve, or when an operator notices duplicate entries, they can manually merge assets:

1. Right-click a node on the diagram or use the sidebar action **"Merge Asset With..."**
2. A list of assets with overlapping identifiers is shown.
3. Select which asset to merge with.
4. A side-by-side comparison shows conflicting field values — the operator picks which value to keep for each field.
5. The two DAL rows are combined into one, and all references (parentId, edges) are updated.

### Metadata Columns

Metadata is represented as additional columns with the prefix `metadata.`. You can define as many metadata columns as needed. Common examples:

| Column Header | Example Value | Description |
|---|---|---|
| `metadata.OS` | `Ubuntu 22.04` | Operating system |
| `metadata.VLAN` | `10` | VLAN assignment |
| `metadata.CIDR` | `10.0.1.0/24` | Subnet CIDR block |
| `metadata.Role` | `Web Server` | Functional role |
| `metadata.Owner` | `Blue Team` | Responsible team or operator |
| `metadata.Classification` | `KT-C` | Mission relevance classification |

## Creating a DAL CSV

### Step 1: Set Up the Spreadsheet

Open your preferred spreadsheet editor (Excel, Google Sheets, LibreOffice Calc) and create the following header row:

```
label,type,ip,mac,hostname,parentId,metadata.OS,metadata.VLAN,metadata.CIDR
```

> **Tip:** You only need the `metadata.*` columns relevant to your mission. Add or remove them as needed.

### Step 2: Add Infrastructure (Top-Down)

Add rows for your network infrastructure in order of hierarchy. Set `parentId` to the label of the parent device.

```
ISP Link,Internet Connection,,,,,,,,
Perimeter FW,Firewall,,,fw-01,ISP Link,,,,
Core Router,Router,,,rtr-core,Perimeter FW,,,,
Core Switch,Switch,,00:1A:2B:3C:4D:01,sw-core,Core Router,,,,
```

### Step 3: Add Subnets

Add a row for each subnet. Use the IP/CIDR field for the subnet address. Set `parentId` to the label of the switch or router the subnet is connected to.

```
DMZ,Subnet,10.0.1.0/24,,,,Core Switch,,10,10.0.1.0/24
Internal Network,Subnet,10.0.2.0/24,,,,Core Switch,,20,10.0.2.0/24
```

### Step 4: Add Devices

Add a row for each device. Provide IP, MAC, and/or hostname for identity. Set `parentId` to the label of the subnet the device belongs to.

```
Web Server,Device,10.0.1.5,00:1A:2B:3C:4D:10,web01,DMZ,Ubuntu,,
Database Server,Device,10.0.2.10,00:1A:2B:3C:4D:20,db01,Internal Network,RHEL 9,,
Admin Workstation,Device,10.0.2.50,00:1A:2B:3C:4D:30,admin01,Internal Network,Windows 11,,
```

### Step 5: Export as CSV

Save or export the file as `.csv` (comma-separated values) using UTF-8 encoding.

## Complete Example

```csv
label,type,ip,mac,hostname,parentId,metadata.OS,metadata.VLAN,metadata.CIDR,metadata.Role
ISP Link,Internet Connection,,,,,,,,,WAN Uplink
Perimeter FW,Firewall,,,fw-perimeter,ISP Link,,,,Perimeter Security
Core Router,Router,,,rtr-core,Perimeter FW,,,,Backbone
Core Switch,Switch,,00:1A:2B:3C:4D:01,sw-core,Core Router,,,,Network Core
DMZ,Subnet,10.0.1.0/24,,,,Core Switch,,10,10.0.1.0/24,Public-Facing
Internal,Subnet,10.0.2.0/24,,,,Core Switch,,20,10.0.2.0/24,Operations
Web Server,Server,10.0.1.5,00:1A:2B:3C:4D:10,web01,DMZ,Ubuntu 22.04,,,HTTP/HTTPS Host
Mail Server,Server,10.0.1.10,00:1A:2B:3C:4D:11,mail01,DMZ,Ubuntu 22.04,,,SMTP Gateway
DB Server,Server,10.0.2.10,00:1A:2B:3C:4D:20,db01,Internal,RHEL 9,,,PostgreSQL
File Server,Server,10.0.2.20,00:1A:2B:3C:4D:21,fs01,Internal,Windows Server 2022,,,SMB Share
Admin Workstation,Workstation,10.0.2.50,00:1A:2B:3C:4D:30,admin01,Internal,Windows 11,,,SOC Analyst
PLC Controller,Operational Technology,10.0.2.100,,plc-01,Internal,,,,Floor Control
```

## Importing into Converge

1. Navigate to a mission and click **Network** in the sidebar.
2. Click the **Import DAL** button in the toolbar.
3. Select your `.csv` file.
4. Converge will validate and smart-merge the CSV into the existing DAL.
5. New assets are added; existing assets (matching on `ip`/`mac`/`hostname`) are updated.

## Exporting from Converge

1. Navigate to a mission's **Network** view.
2. Click the **Export DAL** button in the toolbar.
3. A `.csv` file will download containing all DAL entries for the mission.

## Validation Rules

When importing, Converge validates the following:

- **Required columns** (`label`, `type`) must be present and non-empty.
- **Valid types** — `type` must be one of: `Internet Connection`, `Firewall`, `Router`, `Switch`, `Subnet`, `Workstation`, `Server`, `Operational Technology`, or `Device`.
- **Valid parentId references** — if `parentId` is provided, the referenced label must exist in the CSV or the current DAL. Valid parent types depend on the child's type:
    - **Router** → Internet Connection, Router, Firewall, or Switch
    - **Firewall** → Internet Connection, Router, Switch, or Firewall
    - **Switch** → Router or Firewall
    - **Subnet** → Router, Switch, or Firewall
    - **Workstation / Server / OT / Device** → Subnet
- **Identity recommendation** — a warning is shown if rows lack all three identity fields (`ip`, `mac`, `hostname`), as smart merge cannot deduplicate them.
- Empty metadata values are allowed and will be stored as empty strings.
