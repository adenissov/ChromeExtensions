// JSON Formatter & Validator - Content Script
// Auto-formats JSON and validates fields when viewing INT-REQ pages
// Originally from "311 Integration Request Validator" extension, merged into IR Finder

//=============================================================================
// CONFIGURATION
//=============================================================================
const PROCESSING_DELAY_MS = 300;  // Debounce delay for tab switches
const INITIAL_DELAY_MS = 500;     // Initial delay for page load
let processingTimeout = null;

const indentIncrement = 4;
const jsonKeyColor = "grey";
const jsonValueDefaultColor = "black";
const jsonValueValidColor = "green";
const jsonValueInvalidColor = "red";

//=============================================================================
// STATE VARIABLES (reset between sections)
//=============================================================================
var indentStack = [];
var validationErrMessages = [];
var jsonRootHtmlElement = undefined;
var indent = "";
var validationResultsMap = new Map();

//=============================================================================
// VALIDATION RULES CONFIGURATION
//=============================================================================
// To add new validation rules:
// 1. For simple field pattern matching, add a 'regex' type rule
// 2. For cross-field validation, add a 'conditional' type rule
// 3. For complex custom logic, add a 'custom' type rule
//
// All rule types use the same 'fields' property to specify which fields
// should be highlighted when validation fails.
//=============================================================================
const validationRules = [
	{
		type: 'regex',
		fields: ['response', 'problemTypeDescription', 'additionalInformation'],
		pattern: /^[^\{\}\[\]\|\`\~]*$/,
		message: 'Contains invalid characters'
	},
	{
		type: 'regex',
		fields: ['firstName', 'lastName'],
		pattern: /^[a-zA-Z0-9_]+(([',. \-][a-zA-Z0-9\-\(\)\*_ ])?[a-zA-Z0-9.\-\(\)\* _]*)*$/,
		message: 'Invalid name format'
	},
	{
		type: 'regex',
		fields: ['country', 'province', 'city', 'streetNumberAndSuffix'],
		pattern: /^[A-Za-z0-9'&.,:;_/\(\)\* #\-]*$/,
		message: 'Invalid location format'
	},
	{
		type: 'regex',
		fields: ['primaryContactNumber', 'secondaryContactNumber', 'fax'],
		pattern: /^(\+[0-9 ]*)?[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\.\/0-9 ]*$/,
		message: 'Invalid phone number format'
	},
	{
		type: 'regex',
		fields: ['email'],
		pattern: /^[\w\.-]+@([\w-]+\.)+[\w-]{2,4}$/,
		message: 'Invalid email format'
	},
	{
		type: 'conditional',
		condition: (obj) => obj.division === 'Toronto Water',
		validate: (obj) => {
			if (!obj.participants || !Array.isArray(obj.participants)) return true;
			return obj.participants.every(p => !p.firstName || p.firstName.length <= 30);
		},
		fields: ['firstName'],
		message: 'First name for Toronto Water is longer than 30 characters'
	},
	{
		type: 'conditional',
		condition: (obj) => obj.division === 'Toronto Water',
		validate: (obj) => {
			if (!obj.participants || !Array.isArray(obj.participants)) return true;
			return obj.participants.every(p => !p.lastName || p.lastName.length <= 50);
		},
		fields: ['lastName'],
		message: 'Last name for Toronto Water is longer than 50 characters'
	}
];

//=============================================================================
// VALIDATION FUNCTIONS
//=============================================================================

/**
 * Performs validation on the entire JSON object before rendering.
 * Executes all validation rules and stores results for lookup during rendering.
 * @param {Object} jsonObject - The parsed JSON object to validate
 * @returns {Map} validationResultsMap - Map of field paths to validation results
 */
function performValidation(jsonObject) {
	validationResultsMap.clear();
	
	// Run all validation rules
	validationRules.forEach(rule => {
		executeValidationRule(rule, jsonObject);
	});
	
	return validationResultsMap;
}

/**
 * Execute a single validation rule against the JSON object
 */
function executeValidationRule(rule, jsonObject) {
	switch (rule.type) {
		case 'regex':
			executeRegexRule(rule, jsonObject);
			break;
		case 'conditional':
			executeConditionalRule(rule, jsonObject);
			break;
		case 'custom':
			executeCustomRule(rule, jsonObject);
			break;
	}
}

/**
 * Execute a regex validation rule
 */
function executeRegexRule(rule, jsonObject) {
	rule.fields.forEach(fieldName => {
		traverseAndValidate(jsonObject, fieldName, (value, path) => {
			// Only validate non-empty string values
			if (typeof value !== 'string' || value === '') {
				return;
			}
			var isValid = rule.pattern.test(value);
			validationResultsMap.set(path, {
				isValid: isValid,
				message: isValid ? undefined : rule.message,
				fieldName: fieldName,
				value: value
			});
		});
	});
}

/**
 * Execute a conditional validation rule (for cross-field validation)
 */
function executeConditionalRule(rule, jsonObject) {
	// Check if condition is met
	if (!rule.condition(jsonObject)) {
		return; // Condition not met, skip validation
	}
	
	// Condition met, validate the dependent fields
	var isValid = rule.validate(jsonObject);
	
	// Store results for all affected fields
	rule.fields.forEach(fieldName => {
		traverseAndValidate(jsonObject, fieldName, (value, path) => {
			validationResultsMap.set(path, {
				isValid: isValid,
				message: isValid ? undefined : rule.message,
				fieldName: fieldName,
				value: value
			});
		});
	});
}

/**
 * Execute a custom validation rule
 */
function executeCustomRule(rule, jsonObject) {
	var result = rule.validate(jsonObject);
	
	if (rule.fields) {
		rule.fields.forEach(fieldName => {
			traverseAndValidate(jsonObject, fieldName, (value, path) => {
				validationResultsMap.set(path, {
					isValid: result,
					message: result ? undefined : rule.message,
					fieldName: fieldName,
					value: value
				});
			});
		});
	}
}

/**
 * Traverse JSON object to find fields matching fieldName and apply validation
 */
function traverseAndValidate(obj, fieldName, validationCallback, currentPath = '') {
	if (typeof obj !== 'object' || obj === null) {
		return;
	}

	if (Array.isArray(obj)) {
		obj.forEach((item, index) => {
			var newPath = currentPath ? currentPath + '.' + index : index.toString();
			traverseAndValidate(item, fieldName, validationCallback, newPath);
		});
	} else {
		for (var key in obj) {
			if (obj.hasOwnProperty(key)) {
				var value = obj[key];
				var newPath = currentPath ? currentPath + '.' + key : key;
				
				if (key === fieldName) {
					// Found matching field, validate it
					if (typeof value !== 'object' || value === null) {
						validationCallback(value, newPath);
					}
				}
				
				// Recursively traverse nested objects
				if (typeof value === 'object' && value !== null) {
					traverseAndValidate(value, fieldName, validationCallback, newPath);
				}
			}
		}
	}
}

//=============================================================================
// JSON FORMATTING FUNCTIONS
//=============================================================================

function insertJsonObjectIntoText(key, value, parentElement, fieldPath = "") {
	// Build the current field path
	var currentPath = fieldPath;
	if (key !== "") {
		if (fieldPath === "") {
			currentPath = key;
		} else if (!isNaN(parseInt(key))) {
			// Array index
			currentPath = fieldPath + "." + key;
		} else {
			// Object property
			currentPath = fieldPath + "." + key;
		}
	}
	
	if (typeof value == "object" && Object.keys(value).length > 0) {  // if this is if beginning of an object or of an array
		if(Array.isArray(value)) {  // if key is number - means beginng of an array
			var objectName = (key == "" ? "" : '\"' + key + '\"');
			parentElement.innerHTML += indent;
			parentElement.appendChild(span(objectName, jsonKeyColor, false));
			parentElement.innerHTML += (objectName==''? '' : ": ");
			var numOfJsonObjMembers = Object.keys(value).length;

			parentElement.innerHTML += "[\n";
			indentStack.push( {"objectType" : "array", "countOfObjMembers" : numOfJsonObjMembers} );
			var indentLen = indentStack.length;
			indent = " ".repeat(indentLen * indentIncrement);
		}
		else { 
			// if this is a beginng of an object or of an element of array, the key denotes its index or name.
			// If the key is integer number (i.e. index of an array element) - ignore it
			var objectName = "";
			if (key != "" && isNaN(parseInt(key))) { // if the object name is not empty and not a number, i e a real name
				objectName = '\"' + key + '\"'; // enclose it in double quotes
			};
			parentElement.innerHTML += indent;
			parentElement.appendChild(span(objectName, jsonKeyColor, false));
			parentElement.innerHTML += (objectName==''? '' : ": ");
			var numOfJsonObjMembers = Object.keys(value).length;

			parentElement.innerHTML += "{\n";
			indentStack.push( {"objectType" : "object", "countOfObjMembers" : numOfJsonObjMembers} );
			var indentLen = indentStack.length;
			indent = " ".repeat(indentLen * indentIncrement);
		}
		
		// Recursively process array or object members
		for (var subKey in value) {
			if (value.hasOwnProperty(subKey)) {
				insertJsonObjectIntoText(subKey, value[subKey], parentElement, currentPath);
			}
		}
	}
	else { // an atomic element OR an object with 0 fields
		parentElement.innerHTML += indent;
		var tmpValue = value;

		var idx = indentStack.length - 1;
		var isLastItemOfObject = indentStack[idx].countOfObjMembers == 1; // if this is the last item of object - place no comma after it
		appendFormattedJsonItem(key, tmpValue, parentElement, isLastItemOfObject, currentPath);

		// if this was the last element in block, put the closing bracket
		while(indentStack.length > 0) {
			idx = indentStack.length - 1;
			indentStack[idx].countOfObjMembers--;
			if (indentStack[idx].countOfObjMembers > 0)  // if not the last element in block
				break;

			// if it was the last element in block - put closing bracket
			var indentTmp = " ".repeat((idx) * indentIncrement);
			isLastItemOfObject = (idx == 0 || indentStack[idx-1].countOfObjMembers == 1);
			parentElement.innerHTML += indentTmp +
				(indentStack[idx].objectType == "object" ? "}" : "]") +
				(isLastItemOfObject ? "" : ",")  + "\n";
			indentStack.pop();
		}
		var indentLen = indentStack.length;
		indent = " ".repeat(indentLen * indentIncrement);
	}
}

function appendFormattedJsonItem(key, value, parentElement, isLastItemInBlock, fieldPath) {
	var jsonKeyElement = document.createElement("span");
	parentElement.innerHTML += '\"';
	parentElement.appendChild(span(key, jsonKeyColor, false));
	parentElement.innerHTML += '\": ';

	var jsonValueElement = document.createElement("span");
	var valueText = undefined;

	var color = jsonValueDefaultColor;
	var bold = false;
	
	// Lookup validation result from map instead of validating inline
	var validationResult = validationResultsMap.get(fieldPath);
	var isValueValid = validationResult ? validationResult.isValid : undefined;
	
	if(isValueValid != undefined) {
		switch (isValueValid) {
			case true:  color = jsonValueValidColor; break;
			case false: color = jsonValueInvalidColor; bold = true; break;
		}
	}

	switch (typeof value)
	{
		case "number": 
			parentElement.appendChild(span(value, color, bold));
			break;
		case "object":
			valueText = Array.isArray(value) ? "[]" : "{}" ;
			parentElement.appendChild(span(valueText, color, bold));
			break;
		default:
			parentElement.innerHTML += '\"';
			parentElement.appendChild(span(value, color, bold));
			parentElement.innerHTML += '\"';
	};

	parentElement.innerHTML += (isLastItemInBlock ? '' : ',') + '\n';

	if (isValueValid != undefined && !isValueValid) {
		var validationErrMsg = ('\"' + key + '\": ') + ('\"' + value + '\"');
		if (validationResult && validationResult.message) {
			validationErrMsg += ",  // " + validationResult.message;
		}
		validationErrMessages.push(validationErrMsg);
	}
}

function span(text, color, bold) {
	var spanElem = document.createElement("span");
	spanElem.innerHTML = text;
	spanElem.style.color = color;
	if(bold) {
		spanElem.style.fontWeight = "bold"
	}
	return spanElem;
}

//=============================================================================
// MAIN PROCESSING FUNCTION
//=============================================================================

/**
 * Process all visible "HTTP Request Content" sections on the current page.
 * This is the main entry point called by auto-trigger and manual button.
 */
function processVisibleSections() {
	console.log('[JSONFormatter] processVisibleSections() called');
	
	var subTabs = document.getElementsByClassName("tabContent");
	if (subTabs.length === 0) {
		console.log('[JSONFormatter] No subTabs found - page may not be fully loaded');
		return;
	}

	var subTabsActive = document.getElementsByClassName("tabContent active");
	if (subTabsActive.length === 0) {
		console.log('[JSONFormatter] No active subTabs found');
		return;
	}

	// Search all sub-tabs on the SalesForce page INT-REQ-*** where JSON blocks can be found
	var httpsRequestSections = [];
	var pageSections = document.getElementsByClassName("test-id__section"); 
	if (pageSections.length === 0) {
		console.log('[JSONFormatter] No pageSections found');
		return;
	}
	
	for (let i=0; i<pageSections.length; i++) {
		var pageSectionHeaderTitles = pageSections[i].getElementsByClassName("test-id__section-header-title");
		if(pageSectionHeaderTitles.length > 0) {
			for(let j=0; j<pageSectionHeaderTitles.length; j++) {
				var pageSectionTitleText = pageSectionHeaderTitles[j].textContent;
				if (pageSectionTitleText == "HTTP Request Content") {
					httpsRequestSections.push(pageSections[i]);
				}
			}
		}
	}

	if (httpsRequestSections.length === 0) {
		console.log('[JSONFormatter] No HTTP Request Content sections found');
		return;
	}

	console.log('[JSONFormatter] Processing ' + httpsRequestSections.length + ' HTTP Request Content section(s)');
	
	// For each INT-REQ-*** subTab, prettify JSON blocks on it
	for (let i=0; i<httpsRequestSections.length; i++) {
		// RESET STATE for each section to prevent pollution
		indentStack = [];
		indent = "";
		validationErrMessages = [];
		validationResultsMap = new Map();
		
		var httpsRequestSection = httpsRequestSections[i];
		
		// "HTTP Request Content" expand/collapse button serving as a visual header of the "HTTP Request Content" section
		var buttons = httpsRequestSection.getElementsByClassName("test-id__section-header-button");
		if (buttons.length === 0) {
			console.error('[JSONFormatter] No buttons found in HTTP Request Content section');
			continue;
		}
		var isSectionExpanded = buttons[0].getAttribute("aria-expanded") == "true";
		if(!isSectionExpanded) {
			buttons[0].click();
		}	

		// ---- AT this point, the "HTTP Request Content" section is expanded

		var json_containers = httpsRequestSection.getElementsByTagName("lightning-formatted-text");

		var json_container_in_header = json_containers[0];
		var json_container_in_body = json_containers[1];

		// Check if this section was already processed (contains <pre> tag instead of raw JSON)
		if (json_container_in_body.getElementsByTagName("pre").length > 0) {
			console.log('[JSONFormatter] Section ' + (i+1) + ' already processed, skipping');
			continue;
		}

		console.log('[JSONFormatter] Formatting section ' + (i+1) + ' of ' + httpsRequestSections.length);

		try {
			// Temporary element created from the embedded JSON text
			var json_tmp_obj = undefined;
			
			// Make the pretty JSON text from HTTP request Header
			json_tmp_obj = JSON.parse(json_container_in_header.textContent);
			var requestHeaderJsonElem = document.createElement("pre");
			requestHeaderJsonElem.textContent = JSON.stringify(json_tmp_obj, undefined, indentIncrement);
			json_container_in_header.textContent = "";
			json_container_in_header.appendChild(requestHeaderJsonElem);

			// Make the pretty JSON text from HTTP request Body
			json_tmp_obj = JSON.parse(json_container_in_body.textContent);
			
			// Perform validation pass before rendering
			validationResultsMap = performValidation(json_tmp_obj);
			
			jsonRootHtmlElement = document.createElement("pre");
			// Manually traverse and format JSON instead of using JSON.stringify with replacer
			insertJsonObjectIntoText("", json_tmp_obj, jsonRootHtmlElement, "");

			json_container_in_body.textContent = "";

			// Add validation error messages (if any) before the JSON body
			if(validationErrMessages.length > 0) {
				var validationErrPreElement = document.createElement("pre");
				var validationErrElement = document.createElement("span");
				var validationErrText = "Validation errors:\n";
				for (let j=0; j<validationErrMessages.length; j++) {
					validationErrText += validationErrMessages[j] + "\n";
				}

				validationErrElement.style.color = "red";
				validationErrElement.style.fontWeight = "bold";
				validationErrElement.innerHTML = validationErrText;
				validationErrPreElement.appendChild(validationErrElement);

				json_container_in_body.appendChild(validationErrPreElement);
			}

			json_container_in_body.appendChild(jsonRootHtmlElement);
		} catch (e) {
			console.error('[JSONFormatter] Error processing section ' + (i+1) + ':', e);
		}
	}
	
	console.log('[JSONFormatter] Processing complete');
}

//=============================================================================
// EVENT DETECTION - Tab Click Listener
//=============================================================================

function setupTabClickListeners() {
	// Use event delegation on document body to catch tab clicks
	document.body.addEventListener('click', (event) => {
		// Check if clicked element is a tab-like element
		const target = event.target.closest('[role="tab"], .slds-tabs_default__link, .tabHeader, .uiTabItem, .tabItem');
		if (target) {
			console.log('[JSONFormatter] Tab click detected, scheduling processing');
			scheduleProcessing();
		}
	});
	console.log('[JSONFormatter] Tab click listeners set up');
}

//=============================================================================
// EVENT DETECTION - MutationObserver
//=============================================================================

function setupMutationObserver() {
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
				// Check if any added node contains "HTTP Request Content"
				for (const node of mutation.addedNodes) {
					if (node.nodeType === Node.ELEMENT_NODE) {
						// Check if the node itself or its children contain the target section
						const sections = node.querySelectorAll ? 
							node.querySelectorAll('.test-id__section-header-title') : [];
						for (const section of sections) {
							if (section.textContent === 'HTTP Request Content') {
								console.log('[JSONFormatter] New HTTP Request Content detected via MutationObserver');
								scheduleProcessing();
								return;
							}
						}
						// Also check if the node itself is a section header
						if (node.classList && node.classList.contains('test-id__section-header-title') && 
							node.textContent === 'HTTP Request Content') {
							console.log('[JSONFormatter] HTTP Request Content header added');
							scheduleProcessing();
							return;
						}
					}
				}
			}
		}
	});
	
	observer.observe(document.body, {
		childList: true,
		subtree: true
	});
	
	console.log('[JSONFormatter] MutationObserver set up');
}

//=============================================================================
// DEBOUNCING
//=============================================================================

function scheduleProcessing() {
	if (processingTimeout) {
		clearTimeout(processingTimeout);
	}
	processingTimeout = setTimeout(() => {
		processVisibleSections();
	}, PROCESSING_DELAY_MS);
}

//=============================================================================
// MESSAGE LISTENER (for icon click manual trigger)
//=============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === 'processNow') {
		console.log('[JSONFormatter] Manual trigger received (icon click)');
		processVisibleSections();
	}
});

//=============================================================================
// INITIALIZATION
//=============================================================================

function init() {
	console.log('[JSONFormatter] Initializing (merged into IR Finder extension)');
	
	// Wait for Salesforce to finish initial render
	setTimeout(() => {
		// Process any visible sections on page load
		processVisibleSections();
		
		// Set up listeners for future tab switches
		setupTabClickListeners();
		setupMutationObserver();
		
		console.log('[JSONFormatter] Ready (auto-trigger enabled)');
	}, INITIAL_DELAY_MS);
}

// Entry point - run when content script loads
init();
