/**
 * Copyright © 2013-2017 Magento, Inc. All rights reserved.
 * See COPYING.txt for license details.
 */
/*jshint browser:true*/
/*global define*/
define(
    [
        'ko',
        'underscore',
        'Magento_Ui/js/form/form',
        'Magento_Customer/js/model/customer',
        'Magento_Customer/js/model/address-list',
        'Magento_Checkout/js/model/quote',
        'Magento_Checkout/js/action/create-billing-address',
        'Magento_Checkout/js/action/select-billing-address',
        'Magento_Checkout/js/checkout-data',
        'Magento_Checkout/js/model/checkout-data-resolver',
        'Magento_Customer/js/customer-data',
        'Magento_Checkout/js/action/set-billing-address',
        'Magento_Ui/js/model/messageList',
        'mage/translate'
    ],
    function (
        ko,
        _,
        Component,
        customer,
        addressList,
        quote,
        createBillingAddress,
        selectBillingAddress,
        checkoutData,
        checkoutDataResolver,
        customerData,
        setBillingAddressAction,
        globalMessageList,
        $t
    ) {
        'use strict';

        var lastSelectedBillingAddress = null,
            newAddressOption = {
                /**
                 * Get new address label
                 * @returns {String}
                 */
                getAddressInline: function () {
                    // AAI CHANGE: be more verbose in the dropdown option (old value: 'New Address')
                    return $t('New Billing Address');
                },
                customerAddressId: null
            },
            countryData = customerData.get('directory-data'),
            addressOptions = addressList().filter(function (address) {
                return address.getType() == 'customer-address';
            });

        addressOptions.push(newAddressOption);

        return Component.extend({
            defaults: {
                template: 'Magento_Checkout/billing-address'
            },
            currentBillingAddress: quote.billingAddress,
            addressOptions: addressOptions,
            customerHasAddresses: addressOptions.length > 1,

            /**
             * Init component
             */
            initialize: function () {
                this._super();
                quote.paymentMethod.subscribe(function () {
                    checkoutDataResolver.resolveBillingAddress();
                }, this);
            },

            /**
             * @return {exports.initObservable}
             */
            initObservable: function () {
                // AAI CHANGE: The braintree vault object is added to window.checkoutConfig.payment
                var config = window.checkoutConfig.payment;

                // Vault is always set - when empty it is an array, when populated is it an object
                if (config.vault.constructor === Object) {
                    this._super()
                    .observe({
                        selectedAddress: null,
                        isAddressDetailsVisible: quote.billingAddress() != null,
                        // AAI CHANGE: force the new billing address form to be displayed by default
                        // isAddressFormVisible: !customer.isLoggedIn() || addressOptions.length == 1,
                        isAddressFormVisible: true,
                        isAddressSameAsShipping: true,
                        saveInAddressBook: 1
                    });
                } else {
                    this._super()
                    .observe({
                        // AAI CHANGE: select the 'New Address' option from the drop down
                        selectedAddress: addressOptions[addressOptions.length - 1],
                        isAddressDetailsVisible: quote.billingAddress() != null,
                        // AAI CHANGE: force the new billing address form to be displayed by default
                        // isAddressFormVisible: !customer.isLoggedIn() || addressOptions.length == 1,
                        isAddressFormVisible: true,
                        isAddressSameAsShipping: false,
                        saveInAddressBook: 1
                    });
                }

                quote.billingAddress.subscribe(function (newAddress) {
                    if (quote.isVirtual()) {
                        this.isAddressSameAsShipping(false);
                    } else {
                        this.isAddressSameAsShipping(
                            newAddress != null &&
                            newAddress.getCacheKey() == quote.shippingAddress().getCacheKey()
                        );
                    }

                    if (newAddress != null && newAddress.saveInAddressBook !== undefined) {
                        this.saveInAddressBook(newAddress.saveInAddressBook);
                    } else {
                        this.saveInAddressBook(1);
                    }
                    this.isAddressDetailsVisible(true);
                }, this);

                return this;
            },

            canUseShippingAddress: ko.computed(function () {
                return !quote.isVirtual() && quote.shippingAddress() && quote.shippingAddress().canUseForBilling();
            }),

            /**
             * @param {Object} address
             * @return {*}
             */
            addressOptionsText: function (address) {
                return address.getAddressInline();
            },

            /**
             * @return {Boolean}
             */
            useShippingAddress: function () {
                if (this.isAddressSameAsShipping()) {
                    selectBillingAddress(quote.shippingAddress());

                    this.updateAddresses();
                    this.isAddressDetailsVisible(true);
                } else {
                    lastSelectedBillingAddress = quote.billingAddress();
                    quote.billingAddress(null);
                    this.isAddressDetailsVisible(false);
                }
                checkoutData.setSelectedBillingAddress(null);

                return true;
            },

            /**
             * Update address action
             */
            updateAddress: function () {
                if (this.selectedAddress() && this.selectedAddress() != newAddressOption) {
                    selectBillingAddress(this.selectedAddress());
                    checkoutData.setSelectedBillingAddress(this.selectedAddress().getKey());
                } else {
                    this.source.set('params.invalid', false);
                    this.source.trigger(this.dataScopePrefix + '.data.validate');

                    if (this.source.get(this.dataScopePrefix + '.custom_attributes')) {
                        this.source.trigger(this.dataScopePrefix + '.custom_attributes.data.validate');
                    }

                    if (!this.source.get('params.invalid')) {
                        var addressData = this.source.get(this.dataScopePrefix),
                            newBillingAddress;

                        if (customer.isLoggedIn() && !this.customerHasAddresses) {
                            this.saveInAddressBook(1);
                        }
                        addressData['save_in_address_book'] = this.saveInAddressBook() ? 1 : 0;
                        newBillingAddress = createBillingAddress(addressData);

                        // New address must be selected as a billing address
                        selectBillingAddress(newBillingAddress);
                        checkoutData.setSelectedBillingAddress(newBillingAddress.getKey());
                        checkoutData.setNewCustomerBillingAddress(addressData);
                    }
                }
                this.updateAddresses();
            },

            /**
             * Edit address action
             */
            editAddress: function () {
                lastSelectedBillingAddress = quote.billingAddress();
                quote.billingAddress(null);
                this.isAddressDetailsVisible(false);
            },

            /**
             * Cancel address edit action
             */
            cancelAddressEdit: function () {
                this.restoreBillingAddress();

                if (quote.billingAddress()) {
                    // restore 'Same As Shipping' checkbox state
                    this.isAddressSameAsShipping(
                        quote.billingAddress() != null &&
                            quote.billingAddress().getCacheKey() == quote.shippingAddress().getCacheKey() &&
                            !quote.isVirtual()
                    );
                    this.isAddressDetailsVisible(true);
                }
            },

            /**
             * Restore billing address
             */
            restoreBillingAddress: function () {
                if (lastSelectedBillingAddress != null) {
                    selectBillingAddress(lastSelectedBillingAddress);
                }
            },

            /**
             * @param {Object} address
             */
            onAddressChange: function (address) {
                console.log('onAddressChange address: ', address);
                this.isAddressFormVisible(address == newAddressOption);
            },

            /**
             * @param {int} countryId
             * @return {*}
             */
            getCountryName: function (countryId) {
                return countryData()[countryId] != undefined ? countryData()[countryId].name : '';
            },

            /**
             * Trigger action to update shipping and billing addresses
             */
            updateAddresses: function () {
                if (window.checkoutConfig.reloadOnBillingAddress ||
                    !window.checkoutConfig.displayBillingOnPaymentMethod
                ) {
                    setBillingAddressAction(globalMessageList);
                }
            },

            /**
             * Get code
             * @param {Object} parent
             * @returns {String}
             */
            getCode: function (parent) {
                return _.isFunction(parent.getCode) ? parent.getCode() : 'shared';
            }
        });
    }
);
