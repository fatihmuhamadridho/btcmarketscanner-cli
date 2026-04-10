export class FuturesExchangeInfoRepositoryImpl {
    axiosService;
    constructor(axiosService) {
        this.axiosService = axiosService;
    }
    async getExchangeInfo() {
        return this.axiosService.get('/exchangeInfo');
    }
}
