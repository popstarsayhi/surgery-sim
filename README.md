surgery-sim/
├── backend/
│   ├── main.py              # FastAPI endpoints, CORS, /simulate route
│   ├── models.py            # ✅ 已写完，Pydantic schemas
│   ├── los_fitting.py       # Percentiles → Gamma/LogNormal fit
│   ├── simulation.py        # SimPy DES engine，单次run
│   ├── monte_carlo.py       # 跑N次simulation，aggregate results
│   ├── metrics.py           # Census → staffing gap，KPI计算
│   └── requirements.txt     # ✅ 已写完
│
├── frontend/
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/
│       │   └── simulate.js       # POST /simulate，polling
│       ├── components/
│       │   ├── Sidebar.jsx       # 所有用户输入
│       │   ├── KPICards.jsx      # 6个KPI卡片
│       │   ├── CensusChart.jsx   # Daily peak histogram
│       │   ├── OccupancyChart.jsx # Occupancy over time
│       │   ├── StaffingChart.jsx  # Shift staffing comparison
│       │   ├── OverflowChart.jsx  # Overflow/waiting distribution
│       │   └── PatientTable.jsx   # Sample patient CSV
│       └── styles/
│           └── index.css
│
├── docker-compose.yml        # 一键启动前后端
└── README.md


React
      │
      │ JSON
      ▼
FastAPI
      │
      ▼
Pydantic (SimulationInput)
      │
      │ 自动验证
      ▼
Simulation Engine
      │
      ▼
Pydantic (SimulationOutput)
      │
      │ 自动转换
      ▼
React Dashboard