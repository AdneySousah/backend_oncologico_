import Sequelize, { Model } from "sequelize";



class Comorbidades extends Model {
    static init(sequelize) {
        super.init({
            nome:Sequelize.STRING
               
          
          
        }, {
            sequelize,
            tableName: 'comorbidades',
        });
        return this;
    }
}

export default Comorbidades;