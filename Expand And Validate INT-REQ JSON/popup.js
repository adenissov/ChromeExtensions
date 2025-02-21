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
	const jsonKeyColor = "orange";
	const jsonValueColor = "black";
	const jsonValueValidColor = "green";
	const jsonValueInvalidColor = "red";

	var indentStack = [];

	var jsonRootElement = undefined;
	var indentSpaces = "";
	var numOfObjMembers = 0;

	function insertJsonObjectIntoText(key, value, parentElement) {
		console.log('Add key: ' + key + ' value: ' + value);
		if (typeof value == "object" && Object.keys(value).length > 0) {  // if this is if beginning of an object or of an array
			if(Array.isArray(value)) {  // if key is number - means beginng of an array
				var objectName = (key == "" ? "" : '\"' + key + '\"');
				parentElement.textContent += indentSpaces + objectName + (objectName==''? '' : ": ");
				numOfObjMembers = Object.keys(value).length;

				parentElement.textContent += "[\n";
				indentStack.push( {"objectType" : "array", "countOfObjMembers" : numOfObjMembers} );
				var indent = indentStack.length;
				indentSpaces = " ".repeat(indent * indentIncrement);
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
				parentElement.textContent += indentSpaces + objectName + (objectName==''? '' : ": ");
				numOfObjMembers = Object.keys(value).length;

				parentElement.textContent += "{\n";
				indentStack.push( {"objectType" : "object", "countOfObjMembers" : numOfObjMembers} );
				var indent = indentStack.length;
				indentSpaces = " ".repeat(indent * indentIncrement);
			}
		}
		else { // an atomic element or an object with 0 fields
			parentElement.textContent += indentSpaces;
			var tmpValue = value;

			var idx = indentStack.length - 1;
			var isLastItemInBlock = indentStack[idx].countOfObjMembers == 1; // if this is the last item in block, no comma after it
			appendFormattedJsonItem(key, tmpValue, parentElement, isLastItemInBlock);

			// if this was the last element in block, put the closing bracket
			while(indentStack.length > 0) {
				idx = indentStack.length - 1;
				indentStack[idx].countOfObjMembers--;
				if (indentStack[idx].countOfObjMembers > 0)  // if not the last element in block
					break;

				// if it was the last element in block - put closing bracket
				var indentTmp = " ".repeat((idx) * indentIncrement);
				isLastItemInBlock = (idx == 0 || indentStack[idx-1].countOfObjMembers == 1);
				parentElement.textContent += indentTmp +
					(indentStack[idx].objectType == "object" ? "}" : "]") +
					(isLastItemInBlock ? "" : ",")  + "\n";
				indentStack.pop();
			}
			var indent = indentStack.length;
			indentSpaces = " ".repeat(indent * indentIncrement);
		}
	}

	function appendFormattedJsonItem(key, value, parentElement, isLastItemInBlock) {
		var keyElement = document.createElement("span");
		keyElement.style.color = jsonKeyColor;
		keyElement.textContent = '\"' + key + '\": ';
		parentElement.appendChild (keyElement);

		var valueElement = document.createElement("span");
		var tmpValue = value;
		if(typeof value == "object") {
			tmpValue = Array.isArray(value) ? "[]" : "{}" ;
		}
		else if (typeof value == 'number') {
			tmpValue = value;
		}
		else {
			tmpValue = '\"' + value + '\"';
		};

		var valueIsValidated = validateField(key, value);
		var color = jsonValueColor;
		if (valueIsValidated != undefined) {
			if(valueIsValidated) {
				color = jsonValueValidColor;
			}
			else {
				color = jsonValueInvalidColor;
				tmpValue += '  // *** INVALID';
			}
		}
		valueElement.style.color = color;
		if (valueIsValidated != undefined) {
			valueElement.style.fontWeight = "bold";
		}

		valueElement.textContent = tmpValue;
		parentElement.appendChild (valueElement);
		parentElement.textContent += (isLastItemInBlock ? '' : ',') + '\n';
	}


	function formatJsonItem(item, color, isValidated) {
		var element = document.createElement("span");
		element.style.color = color;
		if(isValidated) {
			element.style.fontWeight = "bold";
		}
		element.textContent = item;
		return element;
	}

	function formatJsonKey(key) {
		var formatted = formatJsonItem(key, jsonKeyColor, false);
	}

	function formatJsonValue(value, isValidated=undefined) {
		var color = isValidated
		var formatted = formatJsonItem(key, jsonKeyColor, false);
	}

	function jsonStringifyReplacer(key, value) {
		console.log("200");
		insertJsonObjectIntoText(key, value, jsonRootElement);
		return value;
	}

	function validateField(key, value) {
		console.log("Key: " + key + " Value: " + value);

		var regexPeopleName = new RegExp("^[a-zA-Z0-9_]+(([',. \\-][a-zA-Z0-9\\-\\(\\)\\*_ ])?[a-zA-Z0-9.\\-\\(\\)\\* _]*)*$");
		var regexDefault  = new RegExp("^[^\\{\\}\\[\\]\\|\\`\\~]*$");
		var regexOrgName = new RegExp("^[A-Za-z0-9'&\\(\\),\\* \\-]*$");
		var regexPlaceName = new RegExp("^[A-Za-z0-9'&.,:;_/\\(\\)\\* #\\-]*$");
		var regexNumbers = new RegExp("^[0-9]*$");
		var regexStatus = new RegExp("^[A-Za-z0-9&\\-\\._ ]*$");
		var regexKey = new RegExp("^[A-Za-z0-9&\\-\\._]+$");
		var regexId = new RegExp("^[A-Za-z0-9&\\-\\._]*$");
		var regexEmail = new RegExp("^[\\w\\.-]+@([\\w-]+\\.)+[\\w-]{2,4}$");
		var regexPhone = new RegExp("^(\\+[0-9 ]*)?[(]{0,1}[0-9]{1,4}[)]{0,1}[-\\s\\.\/0-9 ]*$");
		var regexDates = new RegExp("^\\d{4}-[0-1]\\d-[0-3]\\dT[0-2]\\d:[0-5]\\d:[0-5]\\d\\.\\d{3}(Z|((\\-|\\+))0(0|4|5)00)$");

		var boolResult = undefined;
		switch (key) {
			case "response":
			case "additionalInformation":
							boolResult = regexDefault.test(value);  break;

			case "firstName":
			case "lastName": boolResult = regexDefault.test(value);  break;

			case "primaryContactNumber": 
			case "secondaryContactNumber": 
							boolResult = regexPhone.test(value);  break;

			case "email":	boolResult = regexEmail.test(value);    break;

			case "scheduledStartDate":
			case "scheduledResolutionDate":
			case "transactionDate":
							boolResult = regexDates.test(value);  break;
		};
		if(typeof value == "object") {
			console.log(" Number of object properties: " + Object.keys(value).length);
		}
		if(boolResult != undefined) {
			console.log('---- regex.test: ' + boolResult);
		}
		return boolResult;
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
		console.log(json_container_in_header.textContent);

		// Temporary element created from the embedded JSON text
		var json_tmp_obj = undefined;
		// PRE HTML element to be created to enclose the JSON text in Header and in Body to preserve indents and line breaks
		var new_pre_element = undefined;
		
		// Make the pretty JSON text from HTTP request Header
		json_tmp_obj = JSON.parse(json_container_in_header.textContent);
		new_pre_element = document.createElement("pre");
		new_pre_element.textContent = JSON.stringify(json_tmp_obj, undefined, indentIncrement); // enclose JSON text by PRE HTML element
		json_container_in_header.textContent = ""; 	// remove the previous not formatted JSON text
		json_container_in_header.appendChild(new_pre_element);  // insert new PRE element containing formatted JSON

		// Make the pretty JSON text from HTTP request Body
		json_tmp_obj = JSON.parse(json_container_in_body.textContent);
		new_pre_element = document.createElement("pre");
		jsonRootElement = new_pre_element;
		//new_pre_element.textContent = 
		JSON.stringify(json_tmp_obj, jsonStringifyReplacer, indentIncrement); // enclose JSON text by PRE HTML element

		json_container_in_body.textContent = ""; 	// remove the previous not formatted JSON text
		json_container_in_body.appendChild(new_pre_element);  // insert new PRE element containing formatted JSON
	}	 
}
