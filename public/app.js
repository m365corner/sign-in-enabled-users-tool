const msalInstance = new msal.PublicClientApplication({
    auth: {
        clientId: "<your-client-id>",
        authority: "https://login.microsoftonline.com/<your-tenant-id>",
        redirectUri: "http://localhost:8000",
    },
});

let enabledUsers = [];
let allDepartments = [];
let allJobTitles = [];

// Login
async function login() {
    try {
        const loginResponse = await msalInstance.loginPopup({
            scopes: ["User.Read.All", "Directory.Read.All", "Mail.Send"],
        });
        msalInstance.setActiveAccount(loginResponse.account);
        alert("Login successful.");
        await fetchEnabledUsers();
        await fetchDepartments();
        await fetchJobTitles();
    } catch (error) {
        console.error("Login failed:", error);
        alert("Login failed.");
    }
}

function logout() {
    msalInstance.logoutPopup().then(() => alert("Logout successful."));
}

// Fetch Enabled Users
async function fetchEnabledUsers() {
    const response = await callGraphApi(`/users?$filter=accountEnabled eq true&$select=displayName,userPrincipalName,mail,assignedLicenses,department,jobTitle`);
    enabledUsers = response.value;
}

// Fetch Departments
async function fetchDepartments() {
    allDepartments = [...new Set(enabledUsers.map(user => user.department).filter(Boolean))];
    populateDropdown("departmentDropdown", allDepartments.map(dep => ({ id: dep, name: dep })));
}

// Fetch Job Titles
async function fetchJobTitles() {
    allJobTitles = [...new Set(enabledUsers.map(user => user.jobTitle).filter(Boolean))];
    populateDropdown("jobTitleDropdown", allJobTitles.map(title => ({ id: title, name: title })));
}

// Populate Dropdown
function populateDropdown(dropdownId, items) {
    const dropdown = document.getElementById(dropdownId);
    dropdown.innerHTML = `<option value="">Select</option>`;
    items.forEach(item => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        dropdown.appendChild(option);
    });
}

// Search Function
function search() {
    const searchText = document.getElementById("searchBox").value.toLowerCase();
    const licenseStatus = document.getElementById("licenseDropdown").value;
    const department = document.getElementById("departmentDropdown").value;
    const jobTitle = document.getElementById("jobTitleDropdown").value;

    const filteredUsers = enabledUsers.filter(user => {
        const matchesSearchText = searchText
            ? (user.displayName?.toLowerCase().includes(searchText) ||
               user.userPrincipalName?.toLowerCase().includes(searchText) ||
               user.mail?.toLowerCase().includes(searchText))
            : true;

        const matchesLicense = licenseStatus
            ? (licenseStatus === "Licensed" && user.assignedLicenses.length > 0) ||
              (licenseStatus === "Unlicensed" && user.assignedLicenses.length === 0)
            : true;

        const matchesDepartment = department
            ? user.department === department
            : true;

        const matchesJobTitle = jobTitle
            ? user.jobTitle === jobTitle
            : true;

        return matchesSearchText && matchesLicense && matchesDepartment && matchesJobTitle;
    });

    if (filteredUsers.length === 0) {
        alert("No matching results found.");
    }

    displayResults(filteredUsers);
}

// Display Results
function displayResults(users) {
    const outputBody = document.getElementById("outputBody");
    outputBody.innerHTML = users.map(user => `
        <tr>
            <td>${user.displayName || "N/A"}</td>
            <td>${user.userPrincipalName || "N/A"}</td>
            <td>${user.mail || "N/A"}</td>
            <td>${user.assignedLicenses.length > 0 ? "Licensed" : "Unlicensed"}</td>
            <td>${user.department || "N/A"}</td>
            <td>${user.jobTitle || "N/A"}</td>
        </tr>
    `).join("");
}



// Download Report as CSV
function downloadReportAsCSV() {
    const headers = ["Display Name", "UPN", "Email", "License Status", "Department", "Job Title"];
    const rows = [...document.querySelectorAll("#outputBody tr")].map(tr =>
        [...tr.querySelectorAll("td")].map(td => td.textContent)
    );

    if (!rows.length) {
        alert("No data available to download.");
        return;
    }

    const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Enabled_Users_Report.csv";
    link.click();
}




async function callGraphApi(endpoint, method = "GET", body = null, customHeaders = {}) {
    const account = msalInstance.getActiveAccount();
    if (!account) throw new Error("Please log in first.");

    try {
        const tokenResponse = await msalInstance.acquireTokenSilent({
            scopes: ["User.Read.All", "Directory.Read.All", "Mail.Send"],
            account,
        });

        const headers = {
            Authorization: `Bearer ${tokenResponse.accessToken}`,
            "Content-Type": "application/json",
            ...customHeaders, // Include any additional headers
        };

        const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null, // Serialize body for POST requests
        });

        if (response.ok) {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return await response.json();
            }
            return {}; // Return an empty object for responses with no body
        } else {
            const errorText = await response.text();
            console.error(`Graph API Error (${response.status}):`, errorText);
            throw new Error(`Graph API call failed: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error in callGraphApi:", error);
        throw error;
    }
}



async function sendReportAsMail() {
    const adminEmail = document.getElementById("adminEmail").value;

    if (!adminEmail) {
        alert("Please provide an admin email.");
        return;
    }

    const headers = [...document.querySelectorAll("#outputHeader th")].map(th => th.textContent);
    const rows = [...document.querySelectorAll("#outputBody tr")].map(tr =>
        [...tr.querySelectorAll("td")].map(td => td.textContent)
    );

    if (!rows.length) {
        alert("No data to send via email.");
        return;
    }

    const emailContent = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("");
    const emailBody = `
        <table border="1">
            <thead>
                <tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr>
            </thead>
            <tbody>${emailContent}</tbody>
        </table>
    `;

    const message = {
        message: {
            subject: "Enabled Users Report",
            body: { contentType: "HTML", content: emailBody },
            toRecipients: [{ emailAddress: { address: adminEmail } }],
        },
    };

    try {
        // Correct POST request
        await callGraphApi("/me/sendMail", "POST", message);
        alert("Report sent successfully!");
    } catch (error) {
        console.error("Error sending report:", error);
        alert("Failed to send the report.");
    }
}
