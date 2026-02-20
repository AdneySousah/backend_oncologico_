
import Sequelize,{Model} from "sequelize";

class Diagnostico extends Model{
    static init(sequelize){
        super.init({
            diagnostico: Sequelize.STRING
        }, {
            sequelize,
            tableName: 'diagnostico_cid',
        });
        return this
    }
}


export default Diagnostico;