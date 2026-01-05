let changeColor = document.getElementById("changeColor");

chrome.storage.sync.get("color", ({ color }) => {
  changeColor.style.backgroundColor = color;
});

// When the button is clicked, inject setPageBackgroundColor into current page
changeColor.addEventListener("click", async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: reformatEmbeddedJson,
  });
});

// The body of this function will be executed as a content script inside the
// current page
function reformatEmbeddedJson() {

	const indentIncrement = 4;
	const jsonKeyColor = "grey";
	const jsonValueDefaultColor = "black";
	const jsonValueValidColor = "green";
	const jsonValueInvalidColor = "red";

	var indentStack = [];

	var validationErrMessages = [];
	var jsonRootHtmlElement = undefined;
	var indent = "";
	
	// Validation infrastructure
	var validationResultsMap = new Map();
	
	// Validation rules configuration
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
				console.log('Validating field:', fieldName, 'at path:', path, 'value:', value, 'isValid:', isValid);
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
		
		if (rule.affectedFields) {
			rule.affectedFields.forEach(fieldName => {
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

	function insertJsonObjectIntoText(key, value, parentElement, fieldPath = "") {
		//DEBUG: console.log('Add key: ' + key + ' value: ' + value);
		
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
				// console.log("indentLevel: " + indentLevel);
				// console.log("indent: " + "|" + indent+ "|");
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
		console.log('Rendering field:', key, 'at path:', fieldPath, 'hasResult:', !!validationResult, 'isValid:', validationResult ? validationResult.isValid : 'N/A');
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

	function jsonStringifyReplacer(key, value) {
		insertJsonObjectIntoText(key, value, jsonRootHtmlElement, "");
		return value;
	}
	 
	var subTabs = document.getElementsByClassName("tabContent");
	//DEBUG: console.log('subTabs.length: ' + subTabs.length);
	console.assert(subTabs.length > 0);

	var subTabsActive = document.getElementsByClassName("tabContent active");
	//DEBUG: console.log('subTabsActive.length: ' + subTabsActive.length);
	console.assert(subTabsActive.length > 0);

	// Search all sub-tabs on the SalesForce page INT-REQ-*** where JSON blocks can be found
	var httpsRequestSections = [];
	var pageSections = document.getElementsByClassName("test-id__section"); 
	//DEBUG: console.log('pageSections.length: ' + pageSections.length);
	console.assert(pageSections.length > 0);
	for (let i=0; i<pageSections.length; i++) {
		var pageSectionHeaderTitles = pageSections[i].getElementsByClassName("test-id__section-header-title");
		//DEBUG: console.log('pageSectionHeaderTitles.length: ' + pageSectionHeaderTitles.length);
		if(pageSectionHeaderTitles.length > 0) {
			for(let j=0; j<pageSectionHeaderTitles.length; j++) {
				var pageSectionTitleText = pageSectionHeaderTitles[j].textContent;
				if (pageSectionTitleText == "HTTP Request Content") {
					//DEBUG: console.log("HTTP Request Content section found!")
					httpsRequestSections.push(pageSections[i]);  // form an array of INT-REQ-*** subTabs
				}
			}
		}
	}

	// For each INT-REQ-*** subTab, prettify JSON blocks on it
	for (let i=0; i<httpsRequestSections.length; i++) {
		var httpsRequestSection = httpsRequestSections[i];
		// "HTTP Request Content" expand/collapse button serving as a visual header of the "HTTP Request Content" section
		var buttons = httpsRequestSection.getElementsByClassName("test-id__section-header-button");
		//DEBUG: console.log('Number of buttons: ' + buttons.length);
		console.assert(buttons.length > 0);
		var isSectionExpanded = buttons[0].getAttribute("aria-expanded") == "true";
		//DEBUG: console.log('isSectionExpanded: ' + isSectionExpanded);
		if(!isSectionExpanded ) {
			buttons[0].click();
		}	

		// ---- AT this point, the "HTTP Request Content" section is expanded

		var json_containers = httpsRequestSection.getElementsByTagName("lightning-formatted-text");
		//DEBUG: console.log('Number of json containers: ' + json_containers.length);

		var json_container_in_header = json_containers[0];
		var json_container_in_body = json_containers[1];
		//DEBUG: console.log(json_container_in_header.textContent);

		// Temporary element created from the embedded JSON text
		var json_tmp_obj = undefined;
		
		// Make the pretty JSON text from HTTP request Header
		json_tmp_obj = JSON.parse(json_container_in_header.textContent);
		var requestHeaderJsonElem = document.createElement("pre");
		requestHeaderJsonElem.textContent = JSON.stringify(json_tmp_obj, undefined, indentIncrement); // enclose JSON text by PRE HTML element
		json_container_in_header.textContent = ""; 	// remove the previous not formatted JSON text
		json_container_in_header.appendChild(requestHeaderJsonElem);  // insert new PRE element containing formatted JSON

		// Make the pretty JSON text from HTTP request Body
		json_tmp_obj = JSON.parse(json_container_in_body.textContent);
		
		// PHASE 4: Perform validation pass before rendering
		validationResultsMap = performValidation(json_tmp_obj);
		validationErrMessages = []; // Reset error messages
		
		jsonRootHtmlElement = document.createElement("pre");
		// Manually traverse and format JSON instead of using JSON.stringify with replacer
		insertJsonObjectIntoText("", json_tmp_obj, jsonRootHtmlElement, "");

		json_container_in_body.textContent = ""; 	// remove the previous not formatted JSON text

		// Add validation error messages (if any) before the JSON body
		if(validationErrMessages.length > 0) {
			var validationErrPreElement = document.createElement("pre");
			var validationErrElement = document.createElement("span");
			var validationErrText = "Validation errors:\n";
			for (let i=0; i<validationErrMessages.length; i++) {
				validationErrText += validationErrMessages[i] + "\n";
			}

			validationErrElement.style.color = "red";
			validationErrElement.style.fontWeight = "bold";
			validationErrElement.innerHTML = validationErrText;
			validationErrPreElement.appendChild(validationErrElement);

			json_container_in_body.appendChild(validationErrPreElement);
		}

		json_container_in_body.appendChild(jsonRootHtmlElement);  // insert new PRE element containing formatted JSON
	}	 
}
